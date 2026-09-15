import assert from "node:assert/strict";
import { DockerBackend } from "../executors/docker/index.ts";
import { jobSpecSchema } from "../packages/job-spec/index.ts";

const job = `recovery-${process.pid}-${Date.now()}`;
const backend = new DockerBackend(["docker.io"]);
const spec = jobSpecSchema.parse({
  version: "1",
  runtime: "oci",
  image: {
    repository: "docker.io/library/alpine",
    digest:
      "sha256:14358309a308569c32bdc37e2e0e9694be33a9d99e68afb0f5ff33cc1f695dce",
  },
  command: ["sh", "-c", "sleep 2; echo recovered"],
  resources: {
    gpu: { count: 0, minimumVramMb: 0, allowedModels: [] },
    cpuCores: 1,
    ramMb: 128,
    storageMb: 64,
  },
  execution: { timeoutSeconds: 30, maxStartDelaySeconds: 30 },
  network: { mode: "deny-by-default", allow: [] },
  verification: { policy: "STANDARD" },
  inputs: [],
});

try {
  await backend.prepare(job, spec, []);
  await backend.start(job);
  const restarted = new DockerBackend(["docker.io"]);
  await restarted.recover(job, spec, []);
  const result = await restarted.collectResult(job);
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout.toString().trim(), "recovered");
  assert.ok(result.telemetry.samples > 0);
  console.log("PASS: managed Docker container resumed after worker state loss");
  await restarted.cleanup(job);
} catch (error) {
  await backend.cleanup(job).catch(() => {});
  throw error;
}
