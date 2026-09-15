import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import { commitment } from "../receipts/index.ts";

const exec = promisify(execFile);
const claimSchema = z.record(z.string(), z.unknown());
const resultSchema = z.strictObject({
  claims: z.array(claimSchema).min(1),
  detached_eat: z.unknown(),
  result_code: z.number().int(),
  result_message: z.string(),
});

export type NvidiaAttestation = z.infer<typeof resultSchema>;

export async function attestNvidiaGpu(input: {
  nonce: string;
  policyFile: string;
  binary?: string;
  verifier?: "local" | "remote";
  timeoutMs?: number;
}) {
  if (!/^[a-f0-9]{64}$/.test(input.nonce))
    throw new Error("Attestation nonce must be 32 bytes of lowercase hex");
  const { stdout } = await exec(
    input.binary ?? "nvattest",
    [
      "attest",
      "--device",
      "gpu",
      "--verifier",
      input.verifier ?? "local",
      "--nonce",
      input.nonce,
      "--relying-party-policy",
      input.policyFile,
      "--format",
      "json",
    ],
    { timeout: input.timeoutMs ?? 120_000, maxBuffer: 4 * 1024 * 1024 },
  );
  return validateNvidiaAttestation(JSON.parse(stdout), input.nonce);
}

export function validateNvidiaAttestation(raw: unknown, nonce: string) {
  const attestation = resultSchema.parse(raw);
  const failures: string[] = [];
  const check = (ok: boolean, reason: string) => {
    if (!ok) failures.push(reason);
  };
  check(
    attestation.result_code === 0,
    `NVAT failure: ${attestation.result_message}`,
  );
  for (const claim of attestation.claims) {
    check(
      claim["x-nvidia-device-type"] === "gpu",
      "Non-GPU claim in attestation",
    );
    check(
      claim["x-nvidia-gpu-attestation-report-nonce-match"] === true,
      "Attestation nonce mismatch",
    );
    check(claim.secboot === true, "Secure boot is not enabled");
    check(claim.dbgstat === "disabled", "GPU debug mode is enabled");
    if (typeof claim.nonce === "string")
      check(claim.nonce.toLowerCase() === nonce, "Claim nonce mismatch");
  }
  return {
    passed: failures.length === 0,
    assurance: "VERIFY_4" as const,
    failures,
    evidenceHash: commitment(attestation.detached_eat),
    claimsHash: commitment(attestation.claims),
    attestation,
  };
}
