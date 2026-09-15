import {
  createHash,
  createPublicKey,
  sign,
  verify,
  type KeyObject,
} from "node:crypto";
import canonicalize from "canonicalize";
import { z } from "zod";
import { hash, digest } from "../job-spec/index.ts";
export function canonical(value: unknown): string {
  const result = canonicalize(value);
  if (result === undefined) throw new Error("Value cannot be canonicalized");
  return result;
}
export function sha256(value: Uint8Array | string): string {
  return createHash("sha256").update(value).digest("hex");
}
export function commitment(value: unknown): string {
  return sha256(canonical(value));
}
export const receiptSchema = z.strictObject({
  version: z.literal("1"),
  domain: z.literal("vericompute:receipt:v1"),
  cluster: z.string().min(1),
  program: z.string().min(32),
  jobId: z.string().min(32),
  jobSpecHash: hash,
  provider: z.string().min(32),
  machineId: z.string().min(32),
  worker: z.string().min(32),
  imageDigest: digest,
  inputRoot: hash,
  outputRoot: hash,
  startTimestamp: z.number().int().nonnegative(),
  finishTimestamp: z.number().int().nonnegative(),
  exitCode: z.number().int(),
  gpuUuidCommitment: hash,
  hardwareReportHash: hash,
  telemetryHash: hash,
  stdoutHash: hash,
  stderrHash: hash,
  resultHash: hash,
  nonce: z.string().uuid(),
});
export type ExecutionReceiptV1 = z.infer<typeof receiptSchema>;
export type SignedReceipt = { payload: ExecutionReceiptV1; signature: string };
export function signPayload<T>(
  payload: T,
  key: KeyObject,
): { payload: T; signature: string } {
  return {
    payload,
    signature: sign(null, Buffer.from(canonical(payload)), key).toString(
      "base64",
    ),
  };
}
export function verifyPayload(
  payload: unknown,
  signature: string,
  rawPublicKey: Uint8Array,
): boolean {
  try {
    if (
      rawPublicKey.length !== 32 ||
      Buffer.from(signature, "base64").length !== 64
    )
      return false;
    const key = createPublicKey({
      key: Buffer.concat([
        Buffer.from("302a300506032b6570032100", "hex"),
        rawPublicKey,
      ]),
      format: "der",
      type: "spki",
    });
    return verify(
      null,
      Buffer.from(canonical(payload)),
      key,
      Buffer.from(signature, "base64"),
    );
  } catch {
    return false;
  }
}
