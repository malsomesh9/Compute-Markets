import type { ComputeJobSpecV1 } from "../../packages/job-spec/index.ts";
import type { ExecutionBackend, ExecutionResult } from "../backend.ts";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { sampleGpu } from "../docker/telemetry.ts";
import { enforceOpa } from "../../packages/policy/opa.ts";

const exec = promisify(execFile);
const outputLimit = 1024 * 1024;

export const VLLM_NETWORK = "vericompute-services";

export function vllmDockerArgs(
  job: string,
  spec: ComputeJobSpecV1,
  gpuUuids: string[],
  runtime: "runc" | "runsc" = "runc",
) {
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(job)) throw new Error("Unsafe service ID");
  if (!spec.service || spec.service.kind !== "vllm")
    throw new Error("vLLM executor requires a vLLM service specification");
  if (gpuUuids.length !== spec.resources.gpu.count)
    throw new Error("vLLM GPU assignment does not match the job specification");
  if (gpuUuids.some((gpu) => !/^GPU-[a-fA-F0-9-]+$/.test(gpu)))
    throw new Error("Invalid GPU UUID");
  const model = spec.service.model;
  if (!/^\/[a-zA-Z0-9._/-]+$/.test(model))
    throw new Error(
      "vLLM model must be an absolute path baked into the pinned image",
    );
  return [
    "create",
    "--runtime",
    runtime,
    "--name",
    `vc-service-${job}`,
    "--label",
    "vericompute.managed=true",
    "--label",
    `vericompute.job=${job}`,
    "--user",
    "65532:65532",
    "--read-only",
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges:true",
    "--network",
    VLLM_NETWORK,
    "--publish",
    "127.0.0.1::8000",
    "--pids-limit",
    "1024",
    "--memory",
    `${spec.resources.ramMb}m`,
    "--memory-swap",
    `${spec.resources.ramMb}m`,
    "--cpus",
    String(spec.resources.cpuCores),
    "--tmpfs",
    `/tmp:rw,noexec,nosuid,size=${Math.min(spec.resources.storageMb, 4096)}m`,
    ...(gpuUuids.length ? ["--gpus", `device=${gpuUuids.join(",")}`] : []),
    `${spec.image.repository}@${spec.image.digest}`,
    "vllm",
    "serve",
    model,
    "--host",
    "0.0.0.0",
    "--port",
    "8000",
    "--max-model-len",
    String(spec.service.contextTokens),
    "--tensor-parallel-size",
    String(Math.max(1, spec.resources.gpu.count)),
  ];
}

export function vllmInternalEndpoint(job: string) {
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(job)) throw new Error("Unsafe service ID");
  return `http://vc-service-${job}:8000/v1`;
}

export class VllmBackend implements ExecutionBackend {
  private jobs = new Map<
    string,
    {
      spec: ComputeJobSpecV1;
      gpuUuids: string[];
      startedAt: number;
      endpoint?: string;
    }
  >();

  constructor(
    private options: {
      registries?: string[];
      runtime?: "runc" | "runsc";
    } = {},
  ) {}

  async prepare(job: string, spec: ComputeJobSpecV1, gpuUuids: string[]) {
    vllmDockerArgs(job, spec, gpuUuids, this.options.runtime);
    const registries = this.options.registries ?? [
      "ghcr.io",
      "docker.io",
      "nvcr.io",
    ];
    if (!registries.includes(spec.image.repository.split("/")[0]!))
      throw new Error("Registry is not allowed by this provider");
    if (spec.inputs.length)
      throw new Error("Input materialization is not enabled for vLLM");
    if (spec.security?.isolation === "tee" || spec.security?.confidentialGpu)
      throw new Error("TEE service execution requires a TEE executor");
    if (spec.proof)
      throw new Error("Proof workloads require a proof-capable executor");
    const image = `${spec.image.repository}@${spec.image.digest}`;
    await enforceOpa({
      privileged: false,
      network: VLLM_NETWORK,
      egress: false,
      pid: "private",
      mounts: [],
      image,
      user: "65532",
    });
    await this.assertRuntimeAvailable();
    await exec("docker", ["network", "inspect", VLLM_NETWORK], {
      maxBuffer: outputLimit,
    }).catch(async () => {
      await exec("docker", ["network", "create", "--internal", VLLM_NETWORK], {
        maxBuffer: outputLimit,
      });
    });
    await exec("docker", ["pull", image], {
      timeout: 300_000,
      maxBuffer: outputLimit,
    });
    const inspected = await exec(
      "docker",
      ["image", "inspect", image, "--format", "{{json .RepoDigests}}"],
      { maxBuffer: outputLimit },
    );
    if (
      !(JSON.parse(inspected.stdout) as string[]).some(
        (value) => value.split("@")[1] === spec.image.digest,
      )
    )
      throw new Error("Pulled vLLM image does not match committed digest");
    await exec(
      "docker",
      vllmDockerArgs(job, spec, gpuUuids, this.options.runtime),
      { maxBuffer: outputLimit },
    );
    this.jobs.set(job, { spec, gpuUuids, startedAt: 0 });
  }

  async start(job: string) {
    const state = this.get(job);
    state.startedAt = Math.floor(Date.now() / 1000);
    await exec("docker", ["start", `vc-service-${job}`], {
      maxBuffer: outputLimit,
    });
    state.endpoint = await this.readEndpoint(job);
  }

  async recover(job: string, spec: ComputeJobSpecV1, gpuUuids: string[]) {
    vllmDockerArgs(job, spec, gpuUuids, this.options.runtime);
    await this.assertRuntimeAvailable();
    const inspected = await exec(
      "docker",
      ["inspect", `vc-service-${job}`, "--format", "{{json .}}"],
      { maxBuffer: outputLimit },
    );
    const container = JSON.parse(inspected.stdout);
    if (
      container?.Config?.Labels?.["vericompute.managed"] !== "true" ||
      container?.Config?.Labels?.["vericompute.job"] !== job ||
      container?.Config?.Image !==
        `${spec.image.repository}@${spec.image.digest}`
    )
      throw new Error("Recovered vLLM container does not match the job");
    this.jobs.set(job, {
      spec,
      gpuUuids,
      startedAt: Math.floor(
        new Date(container.State.StartedAt).getTime() / 1000,
      ),
      endpoint: await this.readEndpoint(job),
    });
  }

  async logs(job: string) {
    this.get(job);
    const { stdout, stderr } = await exec(
      "docker",
      ["logs", `vc-service-${job}`],
      { maxBuffer: outputLimit, encoding: "buffer" },
    );
    return { stdout, stderr };
  }

  async status(job: string) {
    this.get(job);
    const { stdout } = await exec(
      "docker",
      ["inspect", "--format", "{{.State.Status}}", `vc-service-${job}`],
      { maxBuffer: outputLimit },
    );
    return stdout.trim() === "running"
      ? ("running" as const)
      : stdout.trim() === "created"
        ? ("prepared" as const)
        : ("finished" as const);
  }

  async stop(job: string) {
    this.get(job);
    await exec("docker", ["kill", `vc-service-${job}`], {
      timeout: 10_000,
      maxBuffer: outputLimit,
    }).catch(() => {});
  }

  async collectResult(job: string): Promise<ExecutionResult> {
    const state = this.get(job);
    const endpoint = state.endpoint ?? (await this.readEndpoint(job));
    const readyDeadline =
      Date.now() + state.spec.execution.maxStartDelaySeconds * 1000;
    let ready = false;
    while (Date.now() < readyDeadline) {
      try {
        const response = await fetch(`${endpoint}/health`);
        if (response.ok) {
          ready = true;
          break;
        }
      } catch {}
      if ((await this.status(job)) !== "running") break;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    if (!ready) {
      await this.stop(job);
      throw new Error("vLLM did not become ready before the start deadline");
    }
    let samples = 0;
    let peakVramMb = 0;
    const sample = async () => {
      const reading = await sampleGpu(state.gpuUuids);
      samples++;
      peakVramMb = Math.max(peakVramMb, reading.peakVramMb);
    };
    await sample();
    const end =
      state.startedAt * 1000 + state.spec.service!.durationSeconds * 1000;
    while (Date.now() < end) {
      await new Promise((resolve) =>
        setTimeout(resolve, Math.min(5000, Math.max(0, end - Date.now()))),
      );
      await sample();
      if ((await this.status(job)) !== "running")
        throw new Error("vLLM stopped before its purchased duration elapsed");
    }
    await this.stop(job);
    const finishedAt = Math.floor(Date.now() / 1000);
    const logs = await this.logs(job);
    return {
      ...logs,
      result: Buffer.from(
        JSON.stringify({
          kind: "vllm",
          model: state.spec.service!.model,
          ready: true,
          servedSeconds: finishedAt - state.startedAt,
        }),
      ),
      exitCode: 0,
      startedAt: state.startedAt,
      finishedAt,
      gpuUuids: state.gpuUuids,
      actualDigest: state.spec.image.digest,
      telemetry: {
        gpuUuids: state.gpuUuids,
        samples,
        peakVramMb,
        durationSeconds: finishedAt - state.startedAt,
      },
    };
  }

  async cleanup(job: string) {
    await exec("docker", ["rm", "-f", `vc-service-${job}`], {
      timeout: 10_000,
      maxBuffer: outputLimit,
    }).catch(() => {});
    this.jobs.delete(job);
  }

  private get(job: string) {
    const state = this.jobs.get(job);
    if (!state) throw new Error("Unknown vLLM service");
    return state;
  }

  private async readEndpoint(job: string) {
    const { stdout } = await exec(
      "docker",
      ["port", `vc-service-${job}`, "8000/tcp"],
      { maxBuffer: outputLimit },
    );
    const match = stdout.trim().match(/127\.0\.0\.1:(\d+)$/m);
    if (!match)
      throw new Error("Docker did not publish the vLLM loopback port");
    return `http://127.0.0.1:${match[1]}`;
  }

  private async assertRuntimeAvailable() {
    const runtime = this.options.runtime ?? "runc";
    const { stdout } = await exec(
      "docker",
      ["info", "--format", "{{json .Runtimes}}"],
      { maxBuffer: outputLimit },
    );
    if (!(JSON.parse(stdout) as Record<string, unknown>)[runtime])
      throw new Error(`Configured OCI runtime ${runtime} is unavailable`);
  }
}
