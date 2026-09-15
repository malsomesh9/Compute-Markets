import assert from "node:assert/strict";
import { admin, checked } from "../packages/config/backend.ts";
import { verifyBundle } from "../apps/verifier/src/verify.ts";
import { jobSpecSchema } from "../packages/job-spec/index.ts";

if (
  !process.env.VERIFIER_KEYPAIR &&
  process.env.SOLANA_RPC_URL?.includes("127.0.0.1")
) {
  process.env.VERIFIER_KEYPAIR = "keys/verifier.json";
}

const cpuSpec = jobSpecSchema.parse({
  version: "1",
  runtime: "oci",
  image: {
    repository: "docker.io/library/alpine",
    digest:
      "sha256:14358309a308569c32bdc37e2e0e9694be33a9d99e68afb0f5ff33cc1f695dce",
  },
  command: ["/bin/sh", "-c", "id -u; test ! -w /etc; echo compute-smoke-ok"],
  resources: {
    gpu: { count: 0, minimumVramMb: 0, allowedModels: [] },
    cpuCores: 1,
    ramMb: 256,
    storageMb: 1024,
  },
  execution: { timeoutSeconds: 300, maxStartDelaySeconds: 180 },
  network: { mode: "deny-by-default", allow: [] },
  verification: { policy: "STANDARD" },
  inputs: [],
});
const knownSpecs: Record<string, unknown> = {
  "3bb01aaeaef3f125ceb76c366d069fc72edcef3201c0fe7d57ad61b8c9372116": cpuSpec,
};

const jobs = await checked(
  admin.database
    .from("jobs")
    .select("id,spec_hash,state")
    .in("state", ["COMPLETED", "FAILED"])
    .order("updated_at", { ascending: false })
    .limit(20),
);
let fixture:
  | {
      job: any;
      receipt: any;
      verification: any;
      spec: any;
      evidence: any;
    }
  | undefined;
for (const job of jobs ?? []) {
  const [receipt, verification, specs] = await Promise.all([
    checked(
      admin.database
        .from("receipts")
        .select("envelope,storage_key")
        .eq("job_id", job.id)
        .maybeSingle(),
    ),
    checked(
      admin.database
        .from("verifications")
        .select("*")
        .eq("job_id", job.id)
        .maybeSingle(),
    ),
    checked(
      admin.database
        .from("job_specs")
        .select("spec")
        .eq("hash", job.spec_hash)
        .limit(1),
    ),
  ]);
  const spec = specs?.[0]?.spec ?? knownSpecs[job.spec_hash];
  if (!receipt || !verification || !spec) continue;
  const blob = await checked(
    admin.storage.from("execution-evidence").download(receipt.storage_key),
  );
  fixture = {
    job,
    receipt,
    verification,
    spec,
    evidence: JSON.parse(await blob!.text()),
  };
  break;
}

if (!fixture) throw new Error("No finalized verifier recovery fixture exists");

try {
  await checked(
    admin.database.from("verifications").delete().eq("job_id", fixture.job.id),
  );
  const result = await verifyBundle({
    envelope: fixture.receipt.envelope,
    spec: fixture.spec,
    evidence: fixture.evidence,
  });
  assert.equal(result.recovered, true);
  assert.equal(result.signature, null);
  const repaired = await checked(
    admin.database
      .from("verifications")
      .select("job_id,passed,tx_signature")
      .eq("job_id", fixture.job.id)
      .maybeSingle(),
  );
  assert.equal(repaired?.job_id, fixture.job.id);
  assert.equal(repaired?.passed, fixture.job.state === "COMPLETED");
  await checked(
    admin.database
      .from("verifications")
      .upsert([fixture.verification], { onConflict: "job_id" }),
  );
  const repeated = await verifyBundle({
    envelope: fixture.receipt.envelope,
    spec: fixture.spec,
    evidence: fixture.evidence,
  });
  assert.equal(repeated.alreadyRecorded, true);
  assert.equal(repeated.signature, fixture.verification.tx_signature);
} finally {
  await checked(
    admin.database
      .from("verifications")
      .upsert([fixture.verification], { onConflict: "job_id" }),
  );
}

console.log(
  `PASS: verifier recovered and idempotently preserved InsForge decision for ${fixture.job.id}`,
);
