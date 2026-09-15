import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { generateKeyPairSync } from "node:crypto";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import bs58 from "bs58";
import { jobSpecSchema } from "../packages/job-spec/index.ts";
import { signPayload, commitment } from "../packages/receipts/index.ts";
import {
  issueChallenge,
  solveChallenge,
  verifyChallenge,
} from "../packages/verification/challenge.ts";
import { verifyRedundantResults } from "../packages/verification/redundancy.ts";
import {
  policyCode,
  policyFromCode,
  assuranceFor,
  verificationPolicies,
} from "../packages/verification/policies.ts";
import {
  SchedulerCoordinator,
  schedulerShard,
  type LeaseRecord,
  type LeaseStore,
} from "../apps/scheduler/src/coordinator.ts";
import { RayBackend } from "../executors/ray/index.ts";
import { validateNvidiaAttestation } from "../packages/verification/attestation.ts";
import { verifyGroth16Proof } from "../packages/verification/proof.ts";
import {
  vllmDockerArgs,
  vllmInternalEndpoint,
} from "../executors/vllm/index.ts";
import { releaseReadiness } from "../packages/release-readiness/index.ts";

const id = "11111111111111111111111111111111";
const digest = "sha256:" + "a".repeat(64);
const base = {
  version: "1" as const,
  runtime: "oci" as const,
  image: { repository: "ghcr.io/acme/test", digest },
  command: ["echo", "safe"],
  resources: {
    gpu: { count: 0, minimumVramMb: 0, allowedModels: [] as string[] },
    cpuCores: 2,
    ramMb: 4096,
    storageMb: 1024,
  },
  execution: { timeoutSeconds: 300, maxStartDelaySeconds: 60 },
  network: { mode: "deny-by-default" as const, allow: [] as never[] },
  verification: { policy: "STANDARD" as const },
  inputs: [],
};

test("verification policy codes are stable and monotonic", () => {
  verificationPolicies.forEach((policy, code) => {
    assert.equal(policyCode(policy), code);
    assert.equal(policyFromCode(code), policy);
    assert.equal(assuranceFor(policy), `VERIFY_${code}`);
  });
  assert.throws(() => policyFromCode(6));
});

test("release readiness cannot claim V1-V3 before every external gate passes", () => {
  const pending = releaseReadiness({}, 1);
  assert.equal(pending.softwareMvpReady, true);
  assert.equal(pending.fullV1V3Ready, false);
  assert.equal(pending.completedGates, 1);
  assert.equal(pending.readinessPercent, 13);

  const qualified = releaseReadiness(
    {
      RELEASE_GPU_QUALIFIED: "true",
      RELEASE_TEE_QUALIFIED: "true",
      RELEASE_PROOF_QUALIFIED: "true",
      RELEASE_PERMISSIONLESS_VERIFIERS: "true",
      RELEASE_OPERATIONS_QUALIFIED: "true",
      RELEASE_AUDITED: "true",
    },
    5,
  );
  assert.equal(qualified.fullV1V3Ready, true);
  assert.equal(qualified.readinessPercent, 100);
});

test("advanced job specifications require matching execution evidence", () => {
  assert.throws(() =>
    jobSpecSchema.parse({ ...base, verification: { policy: "TEE" } }),
  );
  assert.throws(() =>
    jobSpecSchema.parse({ ...base, verification: { policy: "PROOF" } }),
  );
  assert.doesNotThrow(() =>
    jobSpecSchema.parse({
      ...base,
      verification: { policy: "TEE" },
      security: { isolation: "tee", confidentialGpu: true },
    }),
  );
  assert.doesNotThrow(() =>
    jobSpecSchema.parse({
      ...base,
      verification: { policy: "PROOF" },
      proof: {
        system: "groth16",
        circuitHash: "b".repeat(64),
        verificationKeyHash: "c".repeat(64),
      },
    }),
  );
});

test("hidden challenge binds worker, timing and expected result", () => {
  const keys = generateKeyPairSync("ed25519");
  const worker = bs58.encode(
    keys.publicKey.export({ format: "der", type: "spki" }).subarray(-32),
  );
  const { challenge, expectedResultHash } = issueChallenge({
    jobId: id,
    machineId: id,
    worker,
    now: 100,
    ttlSeconds: 30,
    iterations: 10,
  });
  assert.equal(expectedResultHash, solveChallenge(challenge.seed, 10));
  const response = {
    version: "1" as const,
    domain: "vericompute:challenge-response:v1" as const,
    challengeId: challenge.id,
    jobId: id,
    machineId: id,
    worker,
    resultHash: expectedResultHash,
    startedAt: 101,
    finishedAt: 102,
    gpuUuidCommitment: "d".repeat(64),
    telemetryHash: "e".repeat(64),
  };
  const signed = signPayload(response, keys.privateKey);
  assert.equal(
    verifyChallenge({
      challenge,
      expectedResultHash,
      expectedGpuUuidCommitment: "d".repeat(64),
      expectedTelemetryHash: "e".repeat(64),
      response,
      signature: signed.signature,
      now: 103,
    }).passed,
    true,
  );
  assert.equal(
    verifyChallenge({
      challenge,
      expectedResultHash,
      expectedGpuUuidCommitment: "f".repeat(64),
      expectedTelemetryHash: "e".repeat(64),
      response,
      signature: signed.signature,
      now: 103,
    }).passed,
    false,
  );
});

test("redundant verification enforces independent providers and quorum", () => {
  const replicas = [
    {
      jobId: id,
      provider: id,
      machineId: id,
      resultHash: "a".repeat(64),
      verify1Passed: true,
    },
    {
      jobId: "2".repeat(32),
      provider: "2".repeat(32),
      machineId: "3".repeat(32),
      resultHash: "a".repeat(64),
      verify1Passed: true,
    },
  ];
  assert.equal(verifyRedundantResults(replicas).passed, true);
  assert.equal(
    verifyRedundantResults([
      replicas[0]!,
      { ...replicas[1]!, resultHash: "b".repeat(64) },
    ]).dispatchTieBreaker,
    true,
  );
  assert.equal(
    verifyRedundantResults([replicas[0]!, { ...replicas[1]!, provider: id }])
      .passed,
    false,
  );
});

test("scheduler leases use fencing tokens and stable sharding", async () => {
  let current: LeaseRecord | null = null;
  const store: LeaseStore = {
    async claim(lease, owner) {
      if (current && current.owner !== owner) return null;
      current = current ?? {
        lease,
        owner,
        fencingToken: 1,
        expiresAt: new Date(Date.now() + 10_000).toISOString(),
      };
      return current;
    },
    async release(_lease, owner, token) {
      if (current?.owner !== owner || current.fencingToken !== token)
        return false;
      current = null;
      return true;
    },
  };
  const leader = new SchedulerCoordinator(
    store,
    "market",
    10,
    "00000000-0000-4000-8000-000000000001",
  );
  const follower = new SchedulerCoordinator(
    store,
    "market",
    10,
    "00000000-0000-4000-8000-000000000002",
  );
  assert.equal((await leader.acquire())?.fencingToken, 1);
  assert.equal(await follower.acquire(), null);
  leader.assertLeader(1);
  assert.equal(await leader.release(), true);
  assert.equal(schedulerShard(id, 8), schedulerShard(id, 8));
});

test("Ray executor submits a digest-pinned distributed job", async () => {
  let submitted: any;
  const server = createServer((request, response) => {
    response.setHeader("content-type", "application/json");
    if (request.url === "/api/version")
      return response.end(JSON.stringify({ ray_version: "2.58.0" }));
    if (request.url === "/api/jobs/" && request.method === "POST") {
      let body = "";
      request.on("data", (chunk) => (body += chunk));
      return request.on("end", () => {
        submitted = JSON.parse(body);
        response.end(
          JSON.stringify({ submission_id: submitted.submission_id }),
        );
      });
    }
    if (request.url === "/api/jobs/ray-job/logs") {
      response.setHeader("content-type", "text/plain");
      return response.end("distributed result\n");
    }
    if (request.url === "/api/jobs/ray-job")
      return response.end(
        JSON.stringify({ status: "SUCCEEDED", end_time: Date.now() }),
      );
    response.statusCode = 404;
    response.end(JSON.stringify({ error: "missing" }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("No test port");
    const spec = jobSpecSchema.parse({
      ...base,
      distributed: {
        framework: "ray",
        workers: 2,
        gpusPerWorker: 0,
        entrypoint: "python train.py",
      },
    });
    const backend = new RayBackend(`http://127.0.0.1:${address.port}`);
    await backend.prepare("ray-job", spec, []);
    await backend.start("ray-job");
    const result = await backend.collectResult("ray-job");
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout.toString(), "distributed result\n");
    assert.equal(
      submitted.runtime_env.container.image,
      `ghcr.io/acme/test@${digest}`,
    );
    assert.equal(submitted.metadata.vericompute_spec_hash, commitment(spec));
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

test("NVIDIA attestation requires nonce, secure boot and disabled debug mode", () => {
  const nonce = "a".repeat(64);
  const valid = {
    claims: [
      {
        "x-nvidia-device-type": "gpu",
        "x-nvidia-gpu-attestation-report-nonce-match": true,
        secboot: true,
        dbgstat: "disabled",
        nonce,
      },
    ],
    detached_eat: [["JWT", "signed-token"]],
    result_code: 0,
    result_message: "Ok",
  };
  assert.equal(validateNvidiaAttestation(valid, nonce).passed, true);
  assert.equal(
    validateNvidiaAttestation(
      { ...valid, claims: [{ ...valid.claims[0], dbgstat: "enabled" }] },
      nonce,
    ).passed,
    false,
  );
});

test("Groth16 adapter pins public inputs and verification key", async () => {
  const directory = await mkdtemp(join(tmpdir(), "vericompute-snarkjs-test-"));
  const binary = join(directory, "snarkjs");
  await writeFile(binary, "#!/bin/sh\nprintf 'OK!\\n'\n", { mode: 0o700 });
  await chmod(binary, 0o700);
  const bundle = {
    system: "groth16" as const,
    verificationKey: { protocol: "groth16", curve: "bn128" },
    publicSignals: ["1", "2"],
    proof: { pi_a: ["1", "2"] },
  };
  try {
    assert.equal(
      (
        await verifyGroth16Proof({
          bundle,
          expectedVerificationKeyHash: commitment(bundle.verificationKey),
          expectedPublicSignalsHash: commitment(bundle.publicSignals),
          binary,
        })
      ).passed,
      true,
    );
    assert.equal(
      (
        await verifyGroth16Proof({
          bundle,
          expectedVerificationKeyHash: "0".repeat(64),
          expectedPublicSignalsHash: commitment(bundle.publicSignals),
          binary,
        })
      ).passed,
      false,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("vLLM service launch is digest pinned and isolated on an internal network", () => {
  const spec = jobSpecSchema.parse({
    ...base,
    resources: {
      ...base.resources,
      gpu: { count: 1, minimumVramMb: 24576, allowedModels: [] },
    },
    service: {
      kind: "vllm",
      model: "/models/llama",
      contextTokens: 8192,
      replicas: 1,
      durationSeconds: 120,
    },
  });
  const args = vllmDockerArgs("llm-job", spec, ["GPU-1234"]);
  assert.ok(args.includes(`ghcr.io/acme/test@${digest}`));
  assert.ok(args.includes("vericompute-services"));
  assert.equal(args.includes("--privileged"), false);
  assert.equal(
    vllmInternalEndpoint("llm-job"),
    "http://vc-service-llm-job:8000/v1",
  );
});
