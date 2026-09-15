import { test } from "node:test";
import assert from "node:assert/strict";
import { dockerArgs, ociRuntime } from "../executors/docker/index.ts";
import { MockBackend } from "../executors/mock/index.ts";
import { selectBid } from "../apps/scheduler/src/select.ts";
import { jobSpecSchema } from "../packages/job-spec/index.ts";
const spec = jobSpecSchema.parse({
  version: "1",
  runtime: "oci",
  image: {
    repository: "ghcr.io/acme/test",
    digest: "sha256:" + "a".repeat(64),
  },
  command: ["echo", "safe"],
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
test("Docker forces isolation and uses argv without shell interpolation", () => {
  const args = dockerArgs("job123", spec, [
    "GPU-12345678-abcd-abcd-abcd-123456789012",
  ]);
  for (const value of [
    "--read-only",
    "--cap-drop",
    "ALL",
    "no-new-privileges:true",
    "none",
    "65532:65532",
    "--pids-limit",
  ])
    assert.ok(args.includes(value));
  assert.equal(args.includes("--privileged"), false);
  assert.deepEqual(args.slice(0, 3), ["create", "--runtime", "runc"]);
  const sandboxed = dockerArgs(
    "job123",
    spec,
    ["GPU-12345678-abcd-abcd-abcd-123456789012"],
    "runsc",
  );
  assert.equal(sandboxed[sandboxed.indexOf("--runtime") + 1], "runsc");
  assert.equal(ociRuntime(), "runc");
  assert.equal(ociRuntime("runsc"), "runsc");
  assert.throws(() => ociRuntime("kata"));
  assert.throws(() => dockerArgs("../../host", spec, []));
  assert.throws(() => dockerArgs("safe", spec, ["/dev/sda"]));
});
test("mock executor fails closed outside explicit development mode", () => {
  const old = process.env.MOCK_EXECUTOR;
  delete process.env.MOCK_EXECUTOR;
  assert.throws(() => new MockBackend());
  process.env.MOCK_EXECUTOR = old;
});
test("auction filters expired and overbudget bids deterministically", () => {
  assert.equal(
    selectBid(
      [
        {
          id: "expired",
          price: 1n,
          expiresAt: 1,
          providerReputation: 100,
          estimatedStart: 1,
        },
        {
          id: "valid",
          price: 10n,
          expiresAt: 200,
          providerReputation: 10,
          estimatedStart: 101,
        },
        {
          id: "too-late",
          price: 2n,
          expiresAt: 200,
          providerReputation: 100,
          estimatedStart: 999,
        },
      ],
      20n,
      110,
      100,
    )?.id,
    "valid",
  );
});
