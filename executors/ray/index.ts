import type { ComputeJobSpecV1 } from "../../packages/job-spec/index.ts";
import { commitment } from "../../packages/receipts/index.ts";
import type { ExecutionBackend, ExecutionResult } from "../backend.ts";

type RayStatus = "PENDING" | "RUNNING" | "STOPPED" | "SUCCEEDED" | "FAILED";

export class RayBackend implements ExecutionBackend {
  private jobs = new Map<
    string,
    { spec: ComputeJobSpecV1; gpuUuids: string[]; startedAt: number }
  >();

  constructor(
    private address: string,
    private headers: Record<string, string> = {},
  ) {
    this.address = address.replace(/\/$/, "");
    const url = new URL(this.address);
    if (!["http:", "https:"].includes(url.protocol))
      throw new Error("Ray address must use HTTP or HTTPS");
  }

  async prepare(job: string, spec: ComputeJobSpecV1, gpuUuids: string[]) {
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(job))
      throw new Error("Unsafe Ray job ID");
    if (!spec.distributed || spec.distributed.framework !== "ray")
      throw new Error("Ray executor requires a distributed Ray specification");
    if (gpuUuids.length !== spec.resources.gpu.count)
      throw new Error(
        "Ray GPU assignment does not match the job specification",
      );
    const version = await this.request("/api/version");
    if (!version?.ray_version) throw new Error("Invalid Ray Jobs API response");
    this.jobs.set(job, { spec, gpuUuids, startedAt: 0 });
  }

  async start(job: string) {
    const state = this.get(job);
    const spec = state.spec;
    const distributed = spec.distributed!;
    const response = await this.request("/api/jobs/", {
      method: "POST",
      body: JSON.stringify({
        submission_id: job,
        entrypoint: distributed.entrypoint,
        runtime_env: {
          container: {
            image: `${spec.image.repository}@${spec.image.digest}`,
            run_options: [
              "--cap-drop=ALL",
              "--security-opt=no-new-privileges:true",
            ],
          },
          env_vars: {
            VERICOMPUTE_JOB_ID: job,
            VERICOMPUTE_WORKERS: String(distributed.workers),
            VERICOMPUTE_GPUS_PER_WORKER: String(distributed.gpusPerWorker),
          },
        },
        metadata: {
          vericompute_job_id: job,
          vericompute_spec_hash: commitment(spec),
          vericompute_image_digest: spec.image.digest,
        },
        entrypoint_num_cpus: spec.resources.cpuCores,
        entrypoint_num_gpus: 0,
        entrypoint_memory: spec.resources.ramMb * 1024 * 1024,
      }),
    });
    if (response?.submission_id !== job && response?.job_id !== job)
      throw new Error("Ray returned a different submission ID");
    state.startedAt = Math.floor(Date.now() / 1000);
  }

  async status(job: string) {
    this.get(job);
    const status = (await this.request(`/api/jobs/${encodeURIComponent(job)}`))
      ?.status as RayStatus;
    if (status === "PENDING") return "prepared" as const;
    if (status === "RUNNING") return "running" as const;
    if (["STOPPED", "SUCCEEDED", "FAILED"].includes(status))
      return "finished" as const;
    throw new Error(`Unknown Ray status: ${status}`);
  }

  async logs(job: string) {
    this.get(job);
    const response = await fetch(
      `${this.address}/api/jobs/${encodeURIComponent(job)}/logs`,
      { headers: this.headers },
    );
    if (!response.ok)
      throw new Error(`Ray logs failed with HTTP ${response.status}`);
    return {
      stdout: Buffer.from(await response.text()),
      stderr: Buffer.alloc(0),
    };
  }

  async stop(job: string) {
    this.get(job);
    await this.request(`/api/jobs/${encodeURIComponent(job)}/stop`, {
      method: "POST",
      body: "{}",
    });
  }

  async collectResult(job: string): Promise<ExecutionResult> {
    const state = this.get(job);
    const deadline = Date.now() + state.spec.execution.timeoutSeconds * 1000;
    let details: any;
    while (Date.now() < deadline) {
      details = await this.request(`/api/jobs/${encodeURIComponent(job)}`);
      if (["STOPPED", "SUCCEEDED", "FAILED"].includes(details?.status)) break;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    if (
      !details ||
      !["STOPPED", "SUCCEEDED", "FAILED"].includes(details.status)
    ) {
      await this.stop(job).catch(() => {});
      throw new Error("Ray execution timed out");
    }
    const logs = await this.logs(job);
    const finishedAt = Math.floor((details.end_time || Date.now()) / 1000);
    return {
      ...logs,
      result: logs.stdout,
      exitCode: details.status === "SUCCEEDED" ? 0 : 1,
      startedAt: state.startedAt,
      finishedAt,
      gpuUuids: state.gpuUuids,
      actualDigest: state.spec.image.digest,
      telemetry: {
        gpuUuids: state.gpuUuids,
        samples: 1,
        peakVramMb: 0,
        durationSeconds: Math.max(0, finishedAt - state.startedAt),
      },
    };
  }

  async cleanup(job: string) {
    this.jobs.delete(job);
  }

  private get(job: string) {
    const state = this.jobs.get(job);
    if (!state) throw new Error("Unknown Ray job");
    return state;
  }

  private async request(path: string, init: RequestInit = {}) {
    const response = await fetch(`${this.address}${path}`, {
      ...init,
      headers: {
        Accept: "application/json",
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...this.headers,
        ...init.headers,
      },
    });
    if (!response.ok)
      throw new Error(
        `Ray Jobs API ${path} failed with HTTP ${response.status}`,
      );
    return response.json() as Promise<any>;
  }
}
