import type { ComputeJobSpecV1 } from "../packages/job-spec/index.ts";
export type ExecutionResult = {
  stdout: Buffer;
  stderr: Buffer;
  result: Buffer;
  exitCode: number;
  startedAt: number;
  finishedAt: number;
  gpuUuids: string[];
  actualDigest: string;
  telemetry: {
    gpuUuids: string[];
    samples: number;
    peakVramMb: number;
    durationSeconds: number;
  };
};
export interface ExecutionBackend {
  prepare(
    job: string,
    spec: ComputeJobSpecV1,
    gpuUuids: string[],
  ): Promise<void>;
  start(job: string): Promise<void>;
  recover?(
    job: string,
    spec: ComputeJobSpecV1,
    gpuUuids: string[],
  ): Promise<void>;
  logs(job: string): Promise<{ stdout: Buffer; stderr: Buffer }>;
  status(job: string): Promise<"prepared" | "running" | "finished">;
  stop(job: string): Promise<void>;
  collectResult(job: string): Promise<ExecutionResult>;
  cleanup(job: string): Promise<void>;
}
