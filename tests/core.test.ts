import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import bs58 from "bs58";
import { jobSpecSchema } from "../packages/job-spec/index.ts";
import {
  canonical,
  commitment,
  sha256,
  signPayload,
} from "../packages/receipts/index.ts";
import { verifyReceipt } from "../packages/verification/index.ts";
import {
  splitEscrow,
  quoteSupply,
  type Supply,
} from "../packages/pricing/index.ts";
export const spec = jobSpecSchema.parse({
  version: "1",
  runtime: "oci",
  image: {
    repository: "ghcr.io/acme/test",
    digest: "sha256:" + "a".repeat(64),
  },
  command: ["echo", "hello"],
  resources: {
    gpu: { count: 1, minimumVramMb: 24576, allowedModels: [] },
    cpuCores: 2,
    ramMb: 4096,
    storageMb: 1024,
  },
  execution: { timeoutSeconds: 300, maxStartDelaySeconds: 60 },
  network: { mode: "deny-by-default", allow: [] },
  verification: { policy: "STANDARD" },
  inputs: [],
});
test("canonical hashes ignore key insertion order", () =>
  assert.equal(commitment({ b: 2, a: 1 }), commitment({ a: 1, b: 2 })));
test("reject mutable tags, privileged fields, egress and unsupported assurance", () => {
  for (const bad of [
    { ...spec, privileged: true },
    { ...spec, image: { ...spec.image, digest: "latest" } },
    { ...spec, network: { mode: "host", allow: [] } },
    { ...spec, verification: { policy: "TEE" }, security: undefined },
  ])
    assert.throws(() => jobSpecSchema.parse(bad));
});
test("escrow conservation on large amounts and all capped fees", () => {
  for (const amount of [1n, 100n, 1000000n, 18446744073709551615n])
    for (let fee = 0; fee <= 300; fee++) {
      const x = splitEscrow(amount, amount - 1n, fee);
      assert.equal(x.provider + x.fee + x.refund, amount);
    }
  assert.throws(() => splitEscrow(1n, 2n, 200));
  assert.throws(() => splitEscrow(2n, 1n, 301));
});
test("scheduler hard-filters capacity, freshness, deadline, price, policy before ranking", () => {
  const s: Supply = {
    id: "1",
    provider: "p",
    machine: "m",
    gpuModel: "RTX4090",
    gpuCount: 1,
    vramMb: 24576,
    rateBaseUnitsPerSecond: "100",
    region: "EU",
    reputation: 98,
    active: true,
    available: true,
    expiresAt: 2000,
    heartbeatAt: 999,
    estimatedStartSeconds: 10,
    verification: "STANDARD",
    runtime: "oci",
    maxSeconds: 3600,
  };
  assert.equal(
    quoteSupply(
      [
        s,
        { ...s, id: "stale", heartbeatAt: 1 },
        { ...s, id: "small", vramMb: 100 },
        { ...s, id: "expensive", rateBaseUnitsPerSecond: "1000" },
      ],
      spec,
      100000n,
      1000,
    ).length,
    1,
  );
});
test("receipt verifies and rejects signature tampering, replay, revoked key and mismatched output", () => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const worker = bs58.encode(
    publicKey.export({ format: "der", type: "spki" }).subarray(-32),
  );
  const hardware = { gpu: "claimed" };
  const telemetry = {
    gpuUuids: ["GPU-1"],
    samples: 1,
    peakVramMb: 100,
    durationSeconds: 5,
  };
  const result = Buffer.from("hello");
  const e = {
    stdout: result,
    stderr: Buffer.alloc(0),
    result,
    telemetry,
    hardware,
  };
  const payload = {
    version: "1" as const,
    domain: "vericompute:receipt:v1" as const,
    cluster: "localnet",
    program: worker,
    jobId: worker,
    jobSpecHash: commitment(spec),
    provider: worker,
    machineId: worker,
    worker,
    imageDigest: spec.image.digest,
    inputRoot: commitment([]),
    outputRoot: commitment({ result: sha256(result) }),
    startTimestamp: 1000,
    finishTimestamp: 1005,
    exitCode: 0,
    gpuUuidCommitment: commitment(telemetry.gpuUuids),
    hardwareReportHash: commitment(hardware),
    telemetryHash: commitment(telemetry),
    stdoutHash: sha256(result),
    stderrHash: sha256(e.stderr),
    resultHash: sha256(result),
    nonce: randomUUID(),
  };
  const signed = signPayload(payload, privateKey);
  const a = {
    jobId: worker,
    jobSpecHash: commitment(spec),
    verificationPolicy: spec.verification.policy,
    provider: worker,
    machineId: worker,
    worker,
    cluster: "localnet",
    program: worker,
    startedAt: 1000,
    submittedAt: 1005,
    hardwareReportHash: commitment(hardware),
    receiptHash: commitment(payload),
    workerActive: true,
  };
  assert.equal(verifyReceipt(signed, spec, a, e).passed, true);
  assert.equal(
    verifyReceipt(
      { ...signed, payload: { ...payload, exitCode: 1 } },
      spec,
      a,
      e,
    ).passed,
    false,
  );
  assert.equal(
    verifyReceipt(signed, spec, { ...a, jobId: "different-job" }, e).passed,
    false,
  );
  assert.equal(
    verifyReceipt(signed, spec, { ...a, workerActive: false }, e).passed,
    false,
  );
  assert.equal(
    verifyReceipt(signed, spec, { ...a, jobSpecHash: "f".repeat(64) }, e)
      .passed,
    false,
  );
  assert.equal(
    verifyReceipt(signed, spec, { ...a, verificationPolicy: "BASIC" }, e)
      .passed,
    false,
  );
  assert.equal(
    verifyReceipt(signed, spec, a, { ...e, result: Buffer.from("forged") })
      .passed,
    false,
  );
});
