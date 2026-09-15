import { z } from "zod";
import { digest, hash } from "../job-spec/index.ts";

export const benchmarkReportSchema = z.strictObject({
  version: z.literal("1"),
  domain: z.literal("vericompute:benchmark:v1"),
  cluster: z.string().min(1),
  program: z.string().min(32),
  machineId: z.string().min(32),
  worker: z.string().min(32),
  hardwareReportHash: hash,
  imageDigest: digest,
  startedAt: z.number().int().nonnegative(),
  finishedAt: z.number().int().nonnegative(),
  cpuSha256MibPerSecond: z.number().positive(),
  diskWriteMibPerSecond: z.number().positive(),
  gpu: z.array(
    z.strictObject({
      uuid: z.string().regex(/^GPU-[a-fA-F0-9-]+$/),
      vramMb: z.number().int().positive(),
    }),
  ),
  nonce: z.string().uuid(),
});

export type BenchmarkReportV1 = z.infer<typeof benchmarkReportSchema>;

export function benchmarkPassed(report: BenchmarkReportV1) {
  return (
    report.finishedAt >= report.startedAt &&
    report.finishedAt - report.startedAt <= 300 &&
    report.cpuSha256MibPerSecond > 0 &&
    report.diskWriteMibPerSecond > 0
  );
}
