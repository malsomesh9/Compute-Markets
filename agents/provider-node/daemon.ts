import { createPrivateKey, randomUUID } from "node:crypto";
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import {
  chain,
  keypair,
  PublicKey,
  account,
  send,
  BN,
} from "../../packages/solana/client.ts";
import { signPayload, commitment } from "../../packages/receipts/index.ts";
import { enforceExecutionPolicy } from "../../packages/policy/index.ts";
import { loadJournal } from "./journal.ts";
const worker = keypair(process.env.WORKER_KEYPAIR!),
  c = chain(worker),
  machineId = new PublicKey(process.env.MACHINE_ID!),
  api = process.env.COMPUTE_API_URL ?? "http://localhost:4000";
const hardware = JSON.parse(readFileSync(process.env.HARDWARE_REPORT!, "utf8"));
const privateKey = createPrivateKey({
  key: Buffer.concat([
    Buffer.from("302e020100300506032b657004220420", "hex"),
    Buffer.from(worker.secretKey.subarray(0, 32)),
  ]),
  format: "der",
  type: "pkcs8",
});
const cluster = await c.connection.getGenesisHash();
let stopped = false,
  executionActive = false;
async function post(path: string, payload: unknown) {
  const r = await fetch(api + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(signPayload(payload, privateKey)),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json() as Promise<any>;
}
async function tick() {
  const machine = await account(c, "machine", machineId);
  if (
    machine.worker.toBase58() !== worker.publicKey.toBase58() ||
    Buffer.from(machine.hardwareHash).toString("hex") !== commitment(hardware)
  )
    throw new Error(
      "Hardware report or worker is not registered to this machine",
    );
  const now = Math.floor(Date.now() / 1000),
    provider = machine.provider.toBase58();
  await post("/v1/provider/heartbeat", {
    version: "1",
    domain: "vericompute:heartbeat:v1",
    cluster,
    program: c.program.programId.toBase58(),
    machineId: machineId.toBase58(),
    worker: worker.publicKey.toBase58(),
    timestamp: now,
    availableGpuCount: machine.busy ? 0 : machine.gpuCount,
    load: machine.busy ? 1 : 0,
    runningJobs: machine.busy ? [machine.activeJob.toBase58()] : [],
    benchmarkHash: "",
    nonce: randomUUID(),
  });
  if (machine.busy && !executionActive) {
    const j = await account(c, "job", machine.activeJob);
    if ([4, 6, 8].includes(j.state)) {
      const { spec } = await post("/v1/provider/job-spec", {
        version: "1",
        domain: "vericompute:job-spec-request:v1",
        jobId: machine.activeJob.toBase58(),
        worker: worker.publicKey.toBase58(),
        provider,
        timestamp: now,
      });
      mkdirSync("keys/jobs", { recursive: true });
      const specFile = `keys/jobs/${machine.activeJob.toBase58()}.json`;
      writeFileSync(specFile, JSON.stringify(spec), { mode: 0o600 });
      const prior = loadJournal(machine.activeJob.toBase58());
      const workerCommand = j.state === 4 && !prior ? "execute" : "recover";
      executionActive = true;
      const child = spawn(
        process.execPath,
        [
          "--import",
          "tsx",
          "--env-file=.env.local",
          "agents/provider-node/cli.ts",
          workerCommand,
          machine.activeJob.toBase58(),
          specFile,
          process.env.HARDWARE_REPORT!,
        ],
        { stdio: "inherit" },
      );
      child.on("exit", () => {
        executionActive = false;
      });
      child.on("error", () => {
        executionActive = false;
      });
    }
    return;
  }
  if (machine.busy) return;
  const response = await fetch(api + "/v1/provider/intents");
  if (!response.ok) throw new Error("Cannot read open intents");
  const { intents } = (await response.json()) as any;
  for (const intent of intents) {
    try {
      if (intent.deadline <= now + 5) continue;
      const job = new PublicKey(intent.id),
        bid = c.pda("bid", job, machine.provider);
      if (await c.connection.getAccountInfo(bid)) continue;
      const { spec: raw } = await post("/v1/provider/job-spec", {
        version: "1",
        domain: "vericompute:job-spec-request:v1",
        jobId: intent.id,
        worker: worker.publicKey.toBase58(),
        provider,
        timestamp: now,
      });
      const spec = enforceExecutionPolicy(
        raw,
        (process.env.ALLOWED_REGISTRIES ?? "ghcr.io,docker.io,nvcr.io").split(
          ",",
        ),
      );
      if (
        spec.resources.gpu.count > machine.gpuCount ||
        spec.resources.gpu.minimumVramMb > machine.vramMb ||
        (spec.resources.gpu.allowedModels.length &&
          !spec.resources.gpu.allowedModels.includes(hardware.gpu[0]?.model))
      )
        continue;
      const rate = BigInt(process.env.RATE_BASE_UNITS_PER_SECOND ?? "0");
      if (rate <= 0n) throw new Error("Configure a positive provider rate");
      const price = rate * BigInt(spec.execution.timeoutSeconds);
      if (price > BigInt(intent.budget)) continue;
      await send(
        c,
        "placeBid",
        [
          new BN(price.toString()),
          new BN(now + 5),
          new BN(intent.deadline - 1),
        ],
        {
          worker: worker.publicKey,
          job,
          provider: machine.provider,
          workerAuth: c.pda("worker", machine.provider, worker.publicKey),
          machine: machineId,
          bid,
        },
      );
    } catch (error) {
      console.error("Bid skipped:", (error as Error).message);
    }
  }
}
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    stopped = true;
  });
while (!stopped) {
  try {
    await tick();
  } catch (error) {
    console.error((error as Error).message);
  }
  await new Promise((r) => setTimeout(r, 15000));
}
