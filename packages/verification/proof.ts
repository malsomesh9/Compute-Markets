import { execFile } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import { canonical, sha256 } from "../receipts/index.ts";

const exec = promisify(execFile);
const proofBundleSchema = z.strictObject({
  system: z.literal("groth16"),
  verificationKey: z.record(z.string(), z.unknown()),
  publicSignals: z.array(z.union([z.string(), z.number()])),
  proof: z.record(z.string(), z.unknown()),
});

export async function verifyGroth16Proof(input: {
  bundle: unknown;
  expectedVerificationKeyHash: string;
  expectedPublicSignalsHash: string;
  binary?: string;
  timeoutMs?: number;
}) {
  const bundle = proofBundleSchema.parse(input.bundle);
  const failures: string[] = [];
  if (
    sha256(canonical(bundle.verificationKey)) !==
    input.expectedVerificationKeyHash
  )
    failures.push("Verification key commitment mismatch");
  if (
    sha256(canonical(bundle.publicSignals)) !== input.expectedPublicSignalsHash
  )
    failures.push("Public signal commitment mismatch");
  if (failures.length)
    return { passed: false, assurance: "VERIFY_5" as const, failures };

  const directory = await mkdtemp(join(tmpdir(), "vericompute-proof-"));
  try {
    const verificationKey = join(directory, "verification-key.json");
    const publicSignals = join(directory, "public-signals.json");
    const proof = join(directory, "proof.json");
    await Promise.all([
      writeFile(verificationKey, canonical(bundle.verificationKey), {
        mode: 0o600,
      }),
      writeFile(publicSignals, canonical(bundle.publicSignals), {
        mode: 0o600,
      }),
      writeFile(proof, canonical(bundle.proof), { mode: 0o600 }),
    ]);
    try {
      const { stdout } = await exec(
        input.binary ?? "snarkjs",
        ["groth16", "verify", verificationKey, publicSignals, proof],
        { timeout: input.timeoutMs ?? 30_000, maxBuffer: 1024 * 1024 },
      );
      if (!/OK!/.test(stdout))
        failures.push("Groth16 verifier rejected the proof");
    } catch {
      failures.push("Groth16 verifier rejected the proof");
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
  return {
    passed: failures.length === 0,
    assurance: "VERIFY_5" as const,
    failures,
  };
}
