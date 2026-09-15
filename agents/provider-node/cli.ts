import { readFileSync } from "node:fs";
import { createPrivateKey, randomUUID } from "node:crypto";
import {
  chain,
  keypair,
  PublicKey,
  send,
  account,
} from "../../packages/solana/client.ts";
import { jobSpecSchema } from "../../packages/job-spec/index.ts";
import {
  commitment,
  sha256,
  signPayload,
} from "../../packages/receipts/index.ts";
import { DockerBackend, ociRuntime } from "../../executors/docker/index.ts";
import { MockBackend } from "../../executors/mock/index.ts";
import { RayBackend } from "../../executors/ray/index.ts";
import { VllmBackend } from "../../executors/vllm/index.ts";
import type { ExecutionBackend } from "../../executors/backend.ts";
import {
  challengeSchema,
  solveChallenge,
} from "../../packages/verification/challenge.ts";
import { detectHardware } from "./hardware.ts";
import { runBenchmark } from "./benchmark.ts";
import {
  evidencePath,
  loadJournal,
  readEvidence,
  recordJournal,
  writeEvidence,
} from "./journal.ts";
const command = process.argv[2] ?? "status";
const keyPath = process.env.WORKER_KEYPAIR;
if (!keyPath)
  throw new Error(
    "WORKER_KEYPAIR must point to the delegated worker key; never use a provider authority key on a compute host",
  );
const signer = keypair(keyPath),
  c = chain(signer);
const privateKey = createPrivateKey({
  key: Buffer.concat([
    Buffer.from("302e020100300506032b657004220420", "hex"),
    Buffer.from(signer.secretKey.subarray(0, 32)),
  ]),
  format: "der",
  type: "pkcs8",
});
if (command === "status") {
  console.log(
    JSON.stringify(
      {
        worker: signer.publicKey.toBase58(),
        rpc: process.env.SOLANA_RPC_URL,
        solLamports: await c.connection.getBalance(signer.publicKey),
        executor:
          process.env.MOCK_EXECUTOR === "true"
            ? "EXPLICIT DEVELOPMENT MOCK"
            : "docker",
      },
      null,
      2,
    ),
  );
} else if (command === "detect") {
  console.log(
    JSON.stringify(
      await detectHardware(
        process.env.MACHINE_ID ?? "",
        signer.publicKey.toBase58(),
      ),
      null,
      2,
    ),
  );
} else if (command === "benchmark") {
  console.log(JSON.stringify(await runBenchmark(), null, 2));
} else if (command === "heartbeat") {
  const machineId = new PublicKey(process.env.MACHINE_ID!);
  const m = await account(c, "machine", machineId);
  const payload = {
    version: "1",
    domain: "vericompute:heartbeat:v1",
    cluster: await c.connection.getGenesisHash(),
    program: c.program.programId.toBase58(),
    machineId: machineId.toBase58(),
    worker: signer.publicKey.toBase58(),
    timestamp: Math.floor(Date.now() / 1000),
    availableGpuCount: m.busy ? 0 : m.gpuCount,
    load: m.busy ? 1 : 0,
    runningJobs: m.busy ? [m.activeJob.toBase58()] : [],
    benchmarkHash: "",
    nonce: randomUUID(),
  };
  const response = await fetch(
    `${process.env.COMPUTE_API_URL ?? "http://localhost:4000"}/v1/provider/heartbeat`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(signPayload(payload, privateKey)),
    },
  );
  if (!response.ok) throw new Error(await response.text());
  console.log(await response.text());
} else if (command === "execute" || command === "recover") {
  const [jobId, specFile, hardwareFile] = process.argv.slice(3);
  if (!jobId || !specFile || !hardwareFile)
    throw new Error(
      `Usage: ${command} <job-address> <spec.json> <hardware.json>`,
    );
  const job = new PublicKey(jobId),
    spec = jobSpecSchema.parse(JSON.parse(readFileSync(specFile, "utf8"))),
    hardware = JSON.parse(readFileSync(hardwareFile, "utf8"));
  const j = await account(c, "job", job);
  const machine = await account(c, "machine", j.machine);
  if (
    j.worker.toBase58() !== signer.publicKey.toBase58() ||
    Buffer.from(j.specHash).toString("hex") !== commitment(spec) ||
    Buffer.from(machine.hardwareHash).toString("hex") !== commitment(hardware)
  )
    throw new Error("Final assignment or job/hardware commitment mismatch");
  const workerAuth = c.pda("worker", j.provider, signer.publicKey);
  const auth = await account(c, "workerAuthorization", workerAuth);
  if (!auth.active || Number(auth.expiresAt) < Date.now() / 1000)
    throw new Error("Worker revoked or expired");
  const existing = loadJournal(jobId);
  if (existing && command === "execute")
    throw new Error(
      "Execution journal exists. Run recover; duplicate execution refused.",
    );
  const executor: ExecutionBackend = selectExecutor(spec);
  const gpuUuids = hardware.gpu
    .map((g: any) => g.uuid)
    .slice(0, spec.resources.gpu.count);
  let shouldCleanup = false;
  try {
    let bundle = readEvidence(jobId);
    if (command === "recover" && j.state === 8) {
      if (!bundle)
        throw new Error(
          "Receipt is on-chain but local evidence is unavailable",
        );
      await uploadEvidence(jobId, bundle);
      if (spec.verification.policy === "CHALLENGE")
        await completeChallenge(jobId, bundle);
      recordJournal(jobId, "RECEIPT_COMMITTED", {
        recovered: true,
        evidenceFile: evidencePath(jobId),
      });
      console.log(JSON.stringify({ jobId, recovered: true, uploaded: true }));
    } else {
      if (j.state === 4) {
        if (command === "recover")
          await executor.cleanup(jobId).catch(() => {});
        recordJournal(jobId, "PREPARING");
        await executor.prepare(jobId, spec, gpuUuids);
        await send(c, "startJob", [], {
          worker: signer.publicKey,
          job,
          workerAuth,
        });
        await executor.start(jobId);
        recordJournal(jobId, "RUNNING");
      } else if (j.state === 6 && !bundle) {
        if (!executor.recover)
          throw new Error("Configured executor cannot recover running jobs");
        await executor.recover(jobId, spec, gpuUuids);
        recordJournal(jobId, "RUNNING", { recovered: true });
      } else if (j.state !== 6) {
        throw new Error(`Job state ${j.state} is not recoverable by a worker`);
      }

      if (!bundle) {
        const result = await executor.collectResult(jobId);
        const payload = {
          version: "1",
          domain: "vericompute:receipt:v1",
          cluster: await c.connection.getGenesisHash(),
          program: c.program.programId.toBase58(),
          jobId,
          jobSpecHash: commitment(spec),
          provider: j.provider.toBase58(),
          machineId: j.machine.toBase58(),
          worker: signer.publicKey.toBase58(),
          imageDigest: result.actualDigest,
          inputRoot: commitment(spec.inputs),
          outputRoot: commitment({ result: sha256(result.result) }),
          startTimestamp: result.startedAt,
          finishTimestamp: result.finishedAt,
          exitCode: result.exitCode,
          gpuUuidCommitment: commitment(result.gpuUuids),
          hardwareReportHash: commitment(hardware),
          telemetryHash: commitment(result.telemetry),
          stdoutHash: sha256(result.stdout),
          stderrHash: sha256(result.stderr),
          resultHash: sha256(result.result),
          nonce: randomUUID(),
        };
        bundle = {
          envelope: signPayload(payload, privateKey),
          spec,
          evidence: {
            stdout: result.stdout.toString("base64"),
            stderr: result.stderr.toString("base64"),
            result: result.result.toString("base64"),
            telemetry: result.telemetry,
            hardware,
          },
        };
        writeEvidence(jobId, bundle);
        recordJournal(jobId, "EVIDENCE_READY", {
          evidenceFile: evidencePath(jobId),
          receiptHash: commitment(payload),
        });
      }

      const tx = await send(
        c,
        "submitReceipt",
        [[...Buffer.from(commitment(bundle.envelope.payload), "hex")]],
        { worker: signer.publicKey, job, workerAuth },
      );
      await c.connection.confirmTransaction(tx, "finalized");
      await uploadEvidence(jobId, bundle);
      if (spec.verification.policy === "CHALLENGE")
        await completeChallenge(jobId, bundle);
      recordJournal(jobId, "RECEIPT_COMMITTED", {
        tx,
        evidenceFile: evidencePath(jobId),
      });
      shouldCleanup = true;
      console.log(
        JSON.stringify({ jobId, tx, evidenceFile: evidencePath(jobId) }),
      );
    }
  } catch (error) {
    recordJournal(jobId, "FAILED", {
      message: (error as Error).message,
      recoverable: true,
    });
    throw error;
  } finally {
    if (shouldCleanup) await executor.cleanup(jobId).catch(console.error);
  }
} else
  throw new Error(
    "Supported commands: status, detect, benchmark, heartbeat, execute, recover",
  );

async function uploadEvidence(jobId: string, bundle: unknown) {
  if (!process.env.COMPUTE_API_URL) return;
  const response = await fetch(
    `${process.env.COMPUTE_API_URL}/v1/provider/jobs/${jobId}/result`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(bundle),
    },
  );
  if (!response.ok)
    throw new Error(
      `Receipt upload failed; recover persisted evidence: ${await response.text()}`,
    );
}

function selectExecutor(spec: ReturnType<typeof jobSpecSchema.parse>) {
  if (process.env.MOCK_EXECUTOR === "true") return new MockBackend();
  if (spec.distributed) {
    const address = process.env.RAY_JOBS_ADDRESS;
    if (!address)
      throw new Error("RAY_JOBS_ADDRESS is required for distributed jobs");
    const token = process.env.RAY_API_TOKEN;
    return new RayBackend(
      address,
      token ? { Authorization: `Bearer ${token}` } : {},
    );
  }
  if (spec.service)
    return new VllmBackend({ runtime: ociRuntime(process.env.OCI_RUNTIME) });
  return new DockerBackend({ runtime: ociRuntime(process.env.OCI_RUNTIME) });
}

async function completeChallenge(jobId: string, bundle: any) {
  const api = process.env.COMPUTE_API_URL;
  if (!api)
    throw new Error("COMPUTE_API_URL is required for CHALLENGE verification");
  const request = {
    version: "1" as const,
    domain: "vericompute:challenge-request:v1" as const,
    jobId,
    worker: signer.publicKey.toBase58(),
    timestamp: Math.floor(Date.now() / 1000),
    nonce: randomUUID(),
  };
  const challengeResponse = await fetch(
    `${api}/v1/provider/jobs/${jobId}/challenge`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(signPayload(request, privateKey)),
    },
  );
  if (!challengeResponse.ok)
    throw new Error(
      `Challenge request failed: ${await challengeResponse.text()}`,
    );
  const challenge = challengeSchema.parse(
    ((await challengeResponse.json()) as any).challenge,
  );
  const startedAt = Math.floor(Date.now() / 1000);
  const resultHash = solveChallenge(challenge.seed, challenge.iterations);
  const response = {
    version: "1" as const,
    domain: "vericompute:challenge-response:v1" as const,
    challengeId: challenge.id,
    jobId,
    machineId: challenge.machineId,
    worker: signer.publicKey.toBase58(),
    resultHash,
    startedAt,
    finishedAt: Math.floor(Date.now() / 1000),
    gpuUuidCommitment: bundle.envelope.payload.gpuUuidCommitment,
    telemetryHash: bundle.envelope.payload.telemetryHash,
  };
  const submitted = await fetch(
    `${api}/v1/provider/jobs/${jobId}/challenge-response`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(signPayload(response, privateKey)),
    },
  );
  if (!submitted.ok)
    throw new Error(`Challenge response failed: ${await submitted.text()}`);
  const decision = (await submitted.json()) as any;
  if (!decision.passed) throw new Error("Challenge verification failed");
}
