export const jobStates = [
  "CREATED",
  "FUNDED",
  "OPEN",
  "MATCHED",
  "ASSIGNED",
  "STARTING",
  "RUNNING",
  "RESULT_SUBMITTED",
  "VERIFYING",
  "COMPLETED",
  "CANCELLED",
  "EXPIRED",
  "FAILED",
  "DISPUTED",
  "REFUNDED",
] as const;
export type JobState = (typeof jobStates)[number];
export type HardwareReportV1 = {
  version: "1";
  machineId: string;
  worker: string;
  gpu: { model: string; uuid: string; vramMb: number; driver: string }[];
  cpuCores: number;
  ramMb: number;
  capturedAt: number;
};
export type HeartbeatV1 = {
  version: "1";
  domain: "vericompute:heartbeat:v1";
  cluster: string;
  program: string;
  machineId: string;
  worker: string;
  timestamp: number;
  availableGpuCount: number;
  load: number;
  runningJobs: string[];
  benchmarkHash: string;
  nonce: string;
};
export type BidV1 = {
  version: "1";
  domain: "vericompute:bid:v1";
  cluster: string;
  program: string;
  jobId: string;
  provider: string;
  machineId: string;
  worker: string;
  priceBaseUnits: string;
  estimatedStart: number;
  expiresAt: number;
  nonce: string;
};
