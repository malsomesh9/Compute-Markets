import { existsSync, readFileSync } from "node:fs";
import { createPrivateKey, randomUUID } from "node:crypto";
import {
  chain,
  keypair,
  PublicKey,
  account,
} from "../packages/solana/client.ts";
import { signPayload } from "../packages/receipts/index.ts";
if (!process.env.SOLANA_RPC_URL?.includes("127.0.0.1"))
  throw new Error("Fixture workers are restricted to localnet");
const fixturePath = existsSync("research/e2e-cpu-result.json")
  ? "research/e2e-cpu-result.json"
  : "research/e2e-result.json";
const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
let stopping = false;
async function tick() {
  for (const [i, p] of fixture.providers.entries()) {
    const worker = keypair(`keys/worker-${i}.json`),
      c = chain(worker),
      m = await account(c, "machine", new PublicKey(p.machine));
    const privateKey = createPrivateKey({
      key: Buffer.concat([
        Buffer.from("302e020100300506032b657004220420", "hex"),
        Buffer.from(worker.secretKey.subarray(0, 32)),
      ]),
      format: "der",
      type: "pkcs8",
    });
    const payload = {
      version: "1",
      domain: "vericompute:heartbeat:v1",
      cluster: await c.connection.getGenesisHash(),
      program: c.program.programId.toBase58(),
      machineId: p.machine,
      worker: worker.publicKey.toBase58(),
      timestamp: Math.floor(Date.now() / 1000),
      availableGpuCount: m.busy ? 0 : m.gpuCount,
      load: m.busy ? 1 : 0,
      runningJobs: m.busy ? [m.activeJob.toBase58()] : [],
      benchmarkHash: "",
      nonce: randomUUID(),
    };
    const r = await fetch("http://localhost:4000/v1/provider/heartbeat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(signPayload(payload, privateKey)),
    });
    if (!r.ok) throw new Error(await r.text());
  }
}
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    stopping = true;
  });
while (!stopping) {
  try {
    await tick();
  } catch (e) {
    console.error(e);
  }
  await new Promise((r) => setTimeout(r, 30000));
}
