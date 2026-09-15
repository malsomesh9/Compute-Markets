import { sampleGpu } from "./telemetry.ts";
import { enforceOpa } from "../../packages/policy/opa.ts";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { enforceExecutionPolicy } from "../../packages/policy/index.ts";
import type { ComputeJobSpecV1 } from "../../packages/job-spec/index.ts";
import type { ExecutionBackend, ExecutionResult } from "../backend.ts";
const exec = promisify(execFile);
const limit = 1024 * 1024;
export type OciRuntime = "runc" | "runsc";
export function ociRuntime(value = "runc"): OciRuntime {
  if (value !== "runc" && value !== "runsc")
    throw new Error(`Unsupported OCI runtime: ${value}`);
  return value;
}
export function dockerArgs(
  job: string,
  spec: ComputeJobSpecV1,
  gpus: string[],
  runtime: OciRuntime = "runc",
) {
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(job))
    throw new Error("Unsafe container ID");
  if (
    gpus.length !== spec.resources.gpu.count ||
    gpus.some((g) => !/^GPU-[a-fA-F0-9-]+$/.test(g))
  )
    throw new Error("Assignment GPU UUID mismatch");
  return [
    "create",
    "--runtime",
    runtime,
    "--name",
    `vc-${job}`,
    "--label",
    "vericompute.managed=true",
    "--user",
    "65532:65532",
    "--read-only",
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges:true",
    "--network",
    "none",
    "--ipc",
    "private",
    "--pids-limit",
    "128",
    "--memory",
    `${spec.resources.ramMb}m`,
    "--memory-swap",
    `${spec.resources.ramMb}m`,
    "--cpus",
    String(spec.resources.cpuCores),
    "--tmpfs",
    `/tmp:rw,noexec,nosuid,size=${Math.min(spec.resources.storageMb, 1024)}m`,
    "--log-driver",
    "local",
    "--log-opt",
    "max-size=1m",
    "--log-opt",
    "max-file=1",
    "--log-opt",
    "compress=false",
    ...(gpus.length ? ["--gpus", `device=${gpus.join(",")}`] : []),
    `${spec.image.repository}@${spec.image.digest}`,
    ...spec.command,
  ];
}
export class DockerBackend implements ExecutionBackend {
  private jobs = new Map<
    string,
    {
      spec: ComputeJobSpecV1;
      gpuUuids: string[];
      startedAt: number;
      samples: number;
      peakVramMb: number;
      result?: ExecutionResult;
    }
  >();
  private registries: string[];
  private runtime: OciRuntime;
  constructor(
    options: string[] | { registries?: string[]; runtime?: OciRuntime } = {},
  ) {
    this.registries = Array.isArray(options)
      ? options
      : (options.registries ?? ["ghcr.io", "docker.io", "nvcr.io"]);
    this.runtime = Array.isArray(options)
      ? "runc"
      : (options.runtime ?? "runc");
  }
  async prepare(job: string, input: ComputeJobSpecV1, gpuUuids: string[]) {
    const spec = enforceExecutionPolicy(input, this.registries);
    const image = `${spec.image.repository}@${spec.image.digest}`;
    await this.assertRuntimeAvailable();
    await enforceOpa({
      privileged: false,
      network: "none",
      pid: "private",
      mounts: [],
      image,
      user: "65532",
    });
    await exec("docker", ["pull", image], {
      timeout: 300000,
      maxBuffer: limit,
    });
    const inspected = await exec(
      "docker",
      ["image", "inspect", image, "--format", "{{json .RepoDigests}}"],
      { maxBuffer: limit },
    );
    if (
      !(JSON.parse(inspected.stdout) as string[]).some(
        (d) =>
          d.split("@")[1] === spec.image.digest &&
          d.split("@")[0]!.replace(/^docker.io\/(library\/)?/, "") ===
            spec.image.repository.replace(/^docker.io\/(library\/)?/, ""),
      )
    )
      throw new Error("Pulled image does not match committed digest");
    await exec("docker", dockerArgs(job, spec, gpuUuids, this.runtime), {
      maxBuffer: limit,
    });
    this.jobs.set(job, {
      spec,
      gpuUuids,
      startedAt: 0,
      samples: 0,
      peakVramMb: 0,
    });
  }
  async start(job: string) {
    const state = this.get(job);
    state.startedAt = Math.floor(Date.now() / 1000);
    await exec("docker", ["start", `vc-${job}`], { maxBuffer: limit });
  }
  async recover(job: string, input: ComputeJobSpecV1, gpuUuids: string[]) {
    const spec = enforceExecutionPolicy(input, this.registries);
    await this.assertRuntimeAvailable();
    if (
      gpuUuids.length !== spec.resources.gpu.count ||
      gpuUuids.some((g) => !/^GPU-[a-fA-F0-9-]+$/.test(g))
    )
      throw new Error("Assignment GPU UUID mismatch");
    const { stdout } = await exec(
      "docker",
      ["inspect", `vc-${job}`, "--format", "{{json .}}"],
      { maxBuffer: limit },
    );
    const inspected = JSON.parse(stdout);
    if (inspected?.Config?.Labels?.["vericompute.managed"] !== "true")
      throw new Error("Refusing to recover an unmanaged container");
    const expectedImage = `${spec.image.repository}@${spec.image.digest}`;
    if (inspected?.Config?.Image !== expectedImage)
      throw new Error("Recovered container image does not match the job spec");
    const actualRuntime = inspected?.HostConfig?.Runtime || "runc";
    if (actualRuntime !== this.runtime)
      throw new Error(
        "Recovered container runtime does not match provider policy",
      );
    if (
      !inspected?.State?.StartedAt ||
      inspected.State.StartedAt.startsWith("0001-")
    )
      throw new Error("Recovered container was never started");
    this.jobs.set(job, {
      spec,
      gpuUuids,
      startedAt: Math.floor(
        new Date(inspected.State.StartedAt).getTime() / 1000,
      ),
      samples: 0,
      peakVramMb: 0,
    });
  }
  async logs(job: string) {
    this.get(job);
    const { stdout, stderr } = await exec("docker", ["logs", `vc-${job}`], {
      maxBuffer: limit,
      encoding: "buffer",
    });
    return { stdout, stderr };
  }
  async status(job: string) {
    this.get(job);
    const { stdout } = await exec(
      "docker",
      ["inspect", "--format", "{{.State.Status}}", `vc-${job}`],
      { maxBuffer: limit },
    );
    return stdout.trim() === "running"
      ? "running"
      : stdout.trim() === "created"
        ? "prepared"
        : "finished";
  }
  async stop(job: string) {
    this.get(job);
    await exec("docker", ["kill", `vc-${job}`], {
      timeout: 10000,
      maxBuffer: limit,
    }).catch(() => {});
  }
  async collectResult(job: string) {
    const s = this.get(job);
    const reading = await sampleGpu(s.gpuUuids);
    s.samples++;
    s.peakVramMb = reading.peakVramMb;
    let telemetryError: unknown;
    let pending = false;
    const timer = setInterval(() => {
      if (pending) return;
      pending = true;
      void sampleGpu(s.gpuUuids)
        .then((r) => {
          s.samples++;
          s.peakVramMb = Math.max(s.peakVramMb, r.peakVramMb);
        })
        .catch((e) => {
          telemetryError = e;
        })
        .finally(() => {
          pending = false;
        });
    }, 1000);
    try {
      await exec("docker", ["wait", `vc-${job}`], {
        timeout: s.spec.execution.timeoutSeconds * 1000,
        maxBuffer: limit,
      });
    } catch (error) {
      await this.stop(job);
      throw new Error("Execution timed out or Docker wait failed", {
        cause: error,
      });
    } finally {
      clearInterval(timer);
    }
    if (telemetryError) throw telemetryError;
    const inspected = await exec(
      "docker",
      ["inspect", `vc-${job}`, "--format", "{{json .State}}"],
      { maxBuffer: limit },
    );
    const state = JSON.parse(inspected.stdout);
    const logs = await this.logs(job);
    const finishedAt = Math.floor(Date.now() / 1000);

    return {
      ...logs,
      result: logs.stdout,
      exitCode: state.ExitCode,
      startedAt: s.startedAt,
      finishedAt,
      gpuUuids: s.gpuUuids,
      actualDigest: s.spec.image.digest,
      telemetry: {
        gpuUuids: s.gpuUuids,
        samples: s.samples,
        peakVramMb: s.peakVramMb,
        durationSeconds: finishedAt - s.startedAt,
      },
    };
  }
  async cleanup(job: string) {
    await exec("docker", ["rm", "-f", `vc-${job}`], {
      maxBuffer: limit,
      timeout: 10000,
    });
    this.jobs.delete(job);
  }
  private get(job: string) {
    const state = this.jobs.get(job);
    if (!state) throw new Error("Unknown execution");
    return state;
  }
  private async assertRuntimeAvailable() {
    const { stdout } = await exec(
      "docker",
      ["info", "--format", "{{json .Runtimes}}"],
      { maxBuffer: limit },
    );
    const runtimes = JSON.parse(stdout) as Record<string, unknown>;
    if (!runtimes[this.runtime])
      throw new Error(
        `Configured OCI runtime ${this.runtime} is unavailable on this host`,
      );
  }
}
