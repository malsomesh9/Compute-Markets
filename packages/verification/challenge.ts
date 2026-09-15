import { randomBytes, randomUUID } from "node:crypto";
import bs58 from "bs58";
import { z } from "zod";
import { canonical, sha256, verifyPayload } from "../receipts/index.ts";

const hash = z.string().regex(/^[a-f0-9]{64}$/);

export const challengeSchema = z.strictObject({
  version: z.literal("1"),
  domain: z.literal("vericompute:challenge:v1"),
  id: z.string().uuid(),
  jobId: z.string().min(32),
  machineId: z.string().min(32),
  worker: z.string().min(32),
  seed: z.string().regex(/^[a-f0-9]{64}$/),
  iterations: z.number().int().min(1).max(10_000_000),
  issuedAt: z.number().int().nonnegative(),
  expiresAt: z.number().int().positive(),
});

export const challengeResponseSchema = z.strictObject({
  version: z.literal("1"),
  domain: z.literal("vericompute:challenge-response:v1"),
  challengeId: z.string().uuid(),
  jobId: z.string().min(32),
  machineId: z.string().min(32),
  worker: z.string().min(32),
  resultHash: hash,
  startedAt: z.number().int().nonnegative(),
  finishedAt: z.number().int().nonnegative(),
  gpuUuidCommitment: hash,
  telemetryHash: hash,
});

export type ComputeChallengeV1 = z.infer<typeof challengeSchema>;
export type ChallengeResponseV1 = z.infer<typeof challengeResponseSchema>;

/** Deterministic memory-light challenge used before hardware-specific suites. */
export function solveChallenge(seed: string, iterations: number): string {
  let value = Buffer.from(seed, "hex");
  for (let i = 0; i < iterations; i++) {
    const counter = Buffer.allocUnsafe(8);
    counter.writeBigUInt64BE(BigInt(i));
    value = Buffer.from(sha256(Buffer.concat([value, counter])), "hex");
  }
  return value.toString("hex");
}

export function issueChallenge(input: {
  jobId: string;
  machineId: string;
  worker: string;
  now?: number;
  ttlSeconds?: number;
  iterations?: number;
}): { challenge: ComputeChallengeV1; expectedResultHash: string } {
  const now = input.now ?? Math.floor(Date.now() / 1000);
  const challenge = challengeSchema.parse({
    version: "1",
    domain: "vericompute:challenge:v1",
    id: randomUUID(),
    jobId: input.jobId,
    machineId: input.machineId,
    worker: input.worker,
    seed: randomBytes(32).toString("hex"),
    iterations: input.iterations ?? 100_000,
    issuedAt: now,
    expiresAt: now + (input.ttlSeconds ?? 120),
  });
  return {
    challenge,
    expectedResultHash: solveChallenge(challenge.seed, challenge.iterations),
  };
}

export function verifyChallenge(input: {
  challenge: ComputeChallengeV1;
  expectedResultHash: string;
  expectedGpuUuidCommitment?: string;
  expectedTelemetryHash?: string;
  response: ChallengeResponseV1;
  signature: string;
  now?: number;
  maximumSeconds?: number;
}) {
  const challenge = challengeSchema.parse(input.challenge);
  const response = challengeResponseSchema.parse(input.response);
  const failures: string[] = [];
  const check = (ok: boolean, reason: string) => {
    if (!ok) failures.push(reason);
  };
  check(
    verifyPayload(response, input.signature, bs58.decode(challenge.worker)),
    "Invalid worker signature",
  );
  check(response.challengeId === challenge.id, "Challenge mismatch");
  check(response.jobId === challenge.jobId, "Job mismatch");
  check(response.machineId === challenge.machineId, "Machine mismatch");
  check(response.worker === challenge.worker, "Worker mismatch");
  check(
    response.resultHash === input.expectedResultHash,
    "Incorrect challenge result",
  );
  if (input.expectedGpuUuidCommitment)
    check(
      response.gpuUuidCommitment === input.expectedGpuUuidCommitment,
      "GPU UUID commitment does not match the execution receipt",
    );
  if (input.expectedTelemetryHash)
    check(
      response.telemetryHash === input.expectedTelemetryHash,
      "Telemetry commitment does not match the execution receipt",
    );
  check(
    response.startedAt >= challenge.issuedAt - 2,
    "Challenge started before issuance",
  );
  check(response.finishedAt >= response.startedAt, "Invalid challenge timing");
  check(
    response.finishedAt <= challenge.expiresAt,
    "Challenge response expired",
  );
  check(
    response.finishedAt - response.startedAt <= (input.maximumSeconds ?? 120),
    "Challenge exceeded latency bound",
  );
  check(
    (input.now ?? Math.floor(Date.now() / 1000)) <= challenge.expiresAt + 5,
    "Stale verification attempt",
  );
  return {
    passed: failures.length === 0,
    assurance: "VERIFY_2" as const,
    failures,
    challengeCommitment: sha256(canonical(challenge)),
  };
}
