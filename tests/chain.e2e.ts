import assert from "node:assert/strict";
import { randomBytes, randomUUID, createPrivateKey } from "node:crypto";
import { writeFileSync, existsSync } from "node:fs";
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  getAccount,
} from "@solana/spl-token";
import {
  chain,
  keypair,
  Keypair,
  PublicKey,
  BN,
  send,
  account,
} from "../packages/solana/client.ts";
import { jobSpecSchema } from "../packages/job-spec/index.ts";
import { commitment, signPayload } from "../packages/receipts/index.ts";
import { verifyReceipt } from "../packages/verification/index.ts";
import { MockBackend } from "../executors/mock/index.ts";
import { Indexer } from "../apps/indexer/src/indexer.ts";
import { admin, checked } from "../packages/config/backend.ts";
if (!process.env.SOLANA_RPC_URL?.includes("127.0.0.1"))
  throw new Error("E2E fixture only runs on explicit localhost");
process.env.MOCK_EXECUTOR = "true";
const save = (name: string) => {
  const path = `keys/${name}.json`;
  if (existsSync(path)) return keypair(path);
  const k = Keypair.generate();
  writeFileSync(path, JSON.stringify([...k.secretKey]), { mode: 0o600 });
  return k;
};
const owner = keypair("keys/local-admin.json"),
  c = chain(owner),
  verifier = save("verifier"),
  buyer = save("buyer"),
  treasury = save("treasury");
const confirm = async (sig: string) => {
  const latest = await c.connection.getLatestBlockhash();
  await c.connection.confirmTransaction(
    { ...latest, signature: sig },
    "confirmed",
  );
};
for (const k of [owner, verifier, buyer, treasury])
  await confirm(await c.connection.requestAirdrop(k.publicKey, 5e9));
let mint: PublicKey;
const config = c.pda("config");
if (await c.connection.getAccountInfo(config)) {
  mint = (await account(c, "protocolConfig", config)).mint;
} else {
  mint = await createMint(c.connection, owner, owner.publicKey, null, 6);
  const programData = PublicKey.findProgramAddressSync(
    [c.program.programId.toBuffer()],
    new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111"),
  )[0];
  await send(c, "initializeProtocol", [200, new BN(2)], {
    admin: owner.publicKey,
    config,
    mint,
    treasury: treasury.publicKey,
    verifier: verifier.publicKey,
    program: c.program.programId,
    programData,
  });
}
const buyerToken = await getOrCreateAssociatedTokenAccount(
  c.connection,
  owner,
  mint,
  buyer.publicKey,
);
await mintTo(c.connection, owner, mint, buyerToken.address, owner, 1000000n);
const treasuryToken = await getOrCreateAssociatedTokenAccount(
  c.connection,
  owner,
  mint,
  treasury.publicKey,
);
const providers = [];
for (const [i, model] of ["RTX4090", "A100", "H100"].entries()) {
  const authority = save(`provider-${i}`),
    worker = save(`worker-${i}`);
  for (const k of [authority, worker])
    await confirm(await c.connection.requestAirdrop(k.publicKey, 5e9));
  const pc = chain(authority),
    wc = chain(worker),
    provider = pc.pda("provider", authority.publicKey),
    workerAuth = pc.pda("worker", provider, worker.publicKey);
  if (!(await c.connection.getAccountInfo(provider)))
    await send(pc, "registerProvider", [Array.from(randomBytes(32))], {
      authority: authority.publicKey,
      config,
      provider,
    });
  if (!(await c.connection.getAccountInfo(workerAuth)))
    await send(
      pc,
      "authorizeWorker",
      [new BN(Math.floor(Date.now() / 1000) + 86400)],
      {
        authority: authority.publicKey,
        provider,
        worker: worker.publicKey,
        workerAuth,
      },
    );
  const id = randomBytes(32),
    machine = pc.pda("machine", provider, id);
  const hardware = {
    version: "1",
    machineId: machine.toBase58(),
    worker: worker.publicKey.toBase58(),
    gpu: [
      {
        model,
        uuid: `GPU-${i.toString().padStart(8, "0")}-0000-0000-0000-000000000000`,
        vramMb: i === 0 ? 24576 : 81920,
        driver: "development mock",
      },
    ],
    cpuCores: 8,
    ramMb: 32768,
    capturedAt: Math.floor(Date.now() / 1000),
    developmentMock: true,
  };
  await send(
    pc,
    "registerMachine",
    [
      [...id],
      [...Buffer.from(commitment(hardware), "hex")],
      1,
      i === 0 ? 24576 : 81920,
    ],
    { authority: authority.publicKey, provider, workerAuth, machine },
  );
  const offerId = randomBytes(32),
    offer = pc.pda("offer", machine, offerId);
  await send(
    pc,
    "createOffer",
    [
      [...offerId],
      new BN([117, 237, 314][i]!),
      1,
      3600,
      new BN(Math.floor(Date.now() / 1000) + 86400),
    ],
    { authority: authority.publicKey, provider, machine, offer },
  );
  const payout = await getOrCreateAssociatedTokenAccount(
    c.connection,
    owner,
    mint,
    authority.publicKey,
  );
  providers.push({
    authority,
    worker,
    pc,
    wc,
    provider,
    workerAuth,
    machine,
    offer,
    hardware,
    payout,
  });
}
const b = chain(buyer),
  id = randomBytes(32),
  job = b.pda("job", buyer.publicKey, id),
  escrow = b.pda("escrow", job);
const spec = jobSpecSchema.parse({
  version: "1",
  runtime: "oci",
  image: {
    repository: "ghcr.io/vericompute/test",
    digest: "sha256:" + "a".repeat(64),
  },
  command: ["echo", "development"],
  resources: {
    gpu: { count: 1, minimumVramMb: 24576, allowedModels: [] },
    cpuCores: 4,
    ramMb: 16384,
    storageMb: 1024,
  },
  execution: { timeoutSeconds: 300, maxStartDelaySeconds: 180 },
  network: { mode: "deny-by-default", allow: [] },
  verification: { policy: "STANDARD" },
  inputs: [],
});
const deadline = Math.floor(Date.now() / 1000) + 180;
await send(
  b,
  "createJob",
  [
    [...id],
    [...Buffer.from(commitment(spec), "hex")],
    new BN(100000),
    new BN(deadline),
    300,
    1,
  ],
  { buyer: buyer.publicKey, config, job, mint, escrow },
);
const balanceBefore = (await getAccount(c.connection, buyerToken.address))
  .amount;
await send(b, "fundJob", [], {
  buyer: buyer.publicKey,
  job,
  mint,
  source: buyerToken.address,
  escrow,
});
assert.equal((await getAccount(c.connection, escrow)).amount, 100000n);
console.log("PASS: real SPL token escrow");
for (const [i, p] of providers.entries()) {
  p as any;
  await send(
    p.wc,
    "placeBid",
    [
      new BN([35000, 71000, 94000][i]!),
      new BN(Math.floor(Date.now() / 1000) + 10),
      new BN(deadline - 1),
    ],
    {
      worker: p.worker.publicKey,
      job,
      provider: p.provider,
      workerAuth: p.workerAuth,
      machine: p.machine,
      bid: c.pda("bid", job, p.provider),
    },
  );
}
const winner = providers[0]!;
await send(b, "acceptBid", [], {
  buyer: buyer.publicKey,
  job,
  bid: c.pda("bid", job, winner.provider),
  provider: winner.provider,
  machine: winner.machine,
  workerAuth: winner.workerAuth,
});
await assert.rejects(
  send(providers[1]!.wc, "startJob", [], {
    worker: providers[1]!.worker.publicKey,
    job,
    workerAuth: providers[1]!.workerAuth,
  }),
);
console.log("PASS: unauthorized worker rejected");
await send(winner.wc, "startJob", [], {
  worker: winner.worker.publicKey,
  job,
  workerAuth: winner.workerAuth,
});
const startedState = await account(c, "job", job);
const executor = new MockBackend();
await executor.prepare(job.toBase58(), spec, [winner.hardware.gpu[0]!.uuid]);
await executor.start(job.toBase58());
const result = await executor.collectResult(job.toBase58());
const { sha256 } = await import("../packages/receipts/index.ts");
const cluster = await c.connection.getGenesisHash();
const payload = {
  version: "1" as const,
  domain: "vericompute:receipt:v1" as const,
  cluster,
  program: c.program.programId.toBase58(),
  jobId: job.toBase58(),
  jobSpecHash: commitment(spec),
  provider: winner.provider.toBase58(),
  machineId: winner.machine.toBase58(),
  worker: winner.worker.publicKey.toBase58(),
  imageDigest: spec.image.digest,
  inputRoot: commitment(spec.inputs),
  outputRoot: commitment({ result: sha256(result.result) }),
  startTimestamp: Number(startedState.startedAt),
  finishTimestamp: Number(startedState.startedAt),
  exitCode: result.exitCode,
  gpuUuidCommitment: commitment(result.gpuUuids),
  hardwareReportHash: commitment(winner.hardware),
  telemetryHash: commitment(result.telemetry),
  stdoutHash: sha256(result.stdout),
  stderrHash: sha256(result.stderr),
  resultHash: sha256(result.result),
  nonce: randomUUID(),
};
const privateKey = createPrivateKey({
  key: Buffer.concat([
    Buffer.from("302e020100300506032b657004220420", "hex"),
    Buffer.from(winner.worker.secretKey.subarray(0, 32)),
  ]),
  format: "der",
  type: "pkcs8",
});
const envelope = signPayload(payload, privateKey);
await send(
  winner.wc,
  "submitReceipt",
  [[...Buffer.from(commitment(payload), "hex")]],
  { worker: winner.worker.publicKey, job, workerAuth: winner.workerAuth },
);
await assert.rejects(
  send(
    winner.wc,
    "submitReceipt",
    [[...Buffer.from(commitment(payload), "hex")]],
    { worker: winner.worker.publicKey, job, workerAuth: winner.workerAuth },
  ),
);
const state = await account(c, "job", job);
const evidence = {
  stdout: result.stdout,
  stderr: result.stderr,
  result: result.result,
  telemetry: result.telemetry,
  hardware: winner.hardware,
};
const decision = verifyReceipt(
  envelope,
  spec,
  {
    jobId: job.toBase58(),
    jobSpecHash: Buffer.from(state.specHash).toString("hex"),
    verificationPolicy: state.policy === 1 ? "STANDARD" : "BASIC",
    provider: winner.provider.toBase58(),
    machineId: winner.machine.toBase58(),
    worker: winner.worker.publicKey.toBase58(),
    cluster,
    program: c.program.programId.toBase58(),
    startedAt: Number(state.startedAt),
    submittedAt: Number(state.submittedAt),
    hardwareReportHash: commitment(winner.hardware),
    receiptHash: commitment(payload),
    workerActive: true,
  },
  evidence,
);
assert.equal(decision.passed, true, JSON.stringify(decision));
await assert.rejects(
  send(
    winner.wc,
    "submitVerification",
    [[...Buffer.from(commitment(payload), "hex")], true],
    { verifier: winner.worker.publicKey, job },
  ),
);
const verificationTx = await send(
  chain(verifier),
  "submitVerification",
  [[...Buffer.from(commitment(payload), "hex")], true],
  { verifier: verifier.publicKey, job },
);
await new Promise((r) => setTimeout(r, 2500));
const payoutBefore = (await getAccount(c.connection, winner.payout.address))
    .amount,
  feeBefore = (await getAccount(c.connection, treasuryToken.address)).amount;
const settleAccounts = {
  job,
  mint,
  escrow,
  payout: winner.payout.address,
  treasury: treasuryToken.address,
  refund: buyerToken.address,
  provider: winner.provider,
  machine: winner.machine,
};
const settlementTx = await send(b, "settleJob", [], settleAccounts);
assert.equal(
  (await getAccount(c.connection, winner.payout.address)).amount - payoutBefore,
  34300n,
);
assert.equal(
  (await getAccount(c.connection, treasuryToken.address)).amount - feeBefore,
  700n,
);
assert.equal(
  balanceBefore - (await getAccount(c.connection, buyerToken.address)).amount,
  35000n,
);
assert.equal((await getAccount(c.connection, escrow)).amount, 0n);
await assert.rejects(send(b, "settleJob", [], settleAccounts));
await assert.rejects(
  send(b, "refundJob", [], { job, mint, escrow, refund: buyerToken.address }),
);
console.log(
  "PASS: verification, exact payout, fee, refund, double-settlement and double-refund protection",
);
// Wait for finalization, then persist only accounts derived from actual chain state.
await c.connection.confirmTransaction(settlementTx, "finalized");
const indexer = new Indexer(c);
await indexer.backfill();
const stored = await checked(
  admin.database
    .from("jobs")
    .select("state,settled,deposit,provider_paid,fee_paid,refunded")
    .eq("id", job.toBase58())
    .single(),
);
assert.equal(stored?.settled, true);
for (const p of providers) {
  const sig = signPayload(
    p.hardware,
    createPrivateKey({
      key: Buffer.concat([
        Buffer.from("302e020100300506032b657004220420", "hex"),
        Buffer.from(p.worker.secretKey.subarray(0, 32)),
      ]),
      format: "der",
      type: "pkcs8",
    }),
  ).signature;
  await checked(
    admin.database.from("hardware_reports").insert([
      {
        hash: commitment(p.hardware),
        machine_id: p.machine.toBase58(),
        report: p.hardware,
        signature: sig,
      },
    ]),
  );
}
const evidenceJson = JSON.stringify({
  stdout: result.stdout.toString("base64"),
  stderr: result.stderr.toString("base64"),
  result: result.result.toString("base64"),
  telemetry: result.telemetry,
  hardware: winner.hardware,
});
const object = await checked(
  admin.storage
    .from("execution-evidence")
    .upload(
      `${job.toBase58()}/evidence.json`,
      new Blob([evidenceJson], { type: "application/json" }),
    ),
);
await checked(
  admin.database.from("receipts").insert([
    {
      job_id: job.toBase58(),
      receipt_hash: commitment(payload),
      envelope,
      storage_key: object!.key,
      storage_url: object!.url,
    },
  ]),
);
await checked(
  admin.database.from("verifications").insert([
    {
      job_id: job.toBase58(),
      receipt_hash: commitment(payload),
      verifier: verifier.publicKey.toBase58(),
      passed: decision.passed,
      assurance: decision.assurance,
      failures: decision.failures,
      tx_signature: verificationTx,
    },
  ]),
);
await indexer.reconcile();
assert.equal(
  (await checked(
    admin.database.from("jobs").select("id").eq("id", job.toBase58()),
  ))!.length,
  1,
);
writeFileSync(
  "research/e2e-result.json",
  JSON.stringify(
    {
      network: "localnet",
      execution: "explicit development mock",
      program: c.program.programId.toBase58(),
      job: job.toBase58(),
      mint: mint.toBase58(),
      settlementTx,
      verificationTx,
      accounting: stored,
      verifiedAt: new Date().toISOString(),
      providers: providers.map((p) => ({
        provider: p.provider.toBase58(),
        machine: p.machine.toBase58(),
        offer: p.offer.toBase58(),
        worker: p.worker.publicKey.toBase58(),
      })),
    },
    null,
    2,
  ),
);
await executor.cleanup(job.toBase58());
console.log(
  "PASS: finalized InsForge projection, private evidence storage, idempotent reconciliation",
);
