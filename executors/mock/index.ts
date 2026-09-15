import type { ComputeJobSpecV1 } from "../../packages/job-spec/index.ts";
import type { ExecutionBackend, ExecutionResult } from "../backend.ts";
export class MockBackend implements ExecutionBackend {
  private jobs = new Map<
    string,
    { spec: ComputeJobSpecV1; gpuUuids: string[]; startedAt: number }
  >();
  constructor() {
    if (
      process.env.MOCK_EXECUTOR !== "true" ||
      process.env.NODE_ENV === "production"
    )
      throw new Error(
        "Mock execution requires explicit development MOCK_EXECUTOR=true",
      );
  }
  async prepare(job: string, spec: ComputeJobSpecV1, gpuUuids: string[]) {
    this.jobs.set(job, {
      spec,
      gpuUuids,
      startedAt: Math.floor(Date.now() / 1000),
    });
  }
  async start(job: string) {
    this.get(job).startedAt = Math.floor(Date.now() / 1000);
  }
  async logs(job: string) {
    this.get(job);
    return {
      stdout: Buffer.from("Explicit development mock execution\n"),
      stderr: Buffer.alloc(0),
    };
  }
  async status(_job: string) {
    return "finished" as const;
  }
  async stop(_job: string) {}
  async collectResult(job: string): Promise<ExecutionResult> {
    const s = this.get(job),
      logs = await this.logs(job);
    return {
      ...logs,
      result: logs.stdout,
      exitCode: 0,
      startedAt: s.startedAt,
      finishedAt: s.startedAt,
      gpuUuids: s.gpuUuids,
      actualDigest: s.spec.image.digest,
      telemetry: {
        gpuUuids: s.gpuUuids,
        samples: 1,
        peakVramMb: 0,
        durationSeconds: 0,
      },
    };
  }
  async cleanup(job: string) {
    this.jobs.delete(job);
  }
  private get(job: string) {
    const s = this.jobs.get(job);
    if (!s) throw new Error("Unknown job");
    return s;
  }
}
