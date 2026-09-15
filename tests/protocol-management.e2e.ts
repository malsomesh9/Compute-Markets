import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { getOrCreateAssociatedTokenAccount, mintTo } from "@solana/spl-token";
import {
  account,
  BN,
  chain,
  keypair,
  Keypair,
  PublicKey,
  send,
} from "../packages/solana/client.ts";

if (!process.env.SOLANA_RPC_URL?.includes("127.0.0.1")) {
  throw new Error("Protocol management E2E only runs on explicit localhost");
}

const owner = keypair("keys/local-admin.json");
const verifier = keypair("keys/verifier.json");
const c = chain(owner);
const config = c.pda("config");

async function fund(...keys: Keypair[]) {
  for (const key of keys) {
    const signature = await c.connection.requestAirdrop(key.publicKey, 2e9);
    const latest = await c.connection.getLatestBlockhash();
    await c.connection.confirmTransaction(
      { ...latest, signature },
      "confirmed",
    );
  }
}

const authority = Keypair.generate();
const oldWorker = Keypair.generate();
const newWorker = Keypair.generate();
const buyer = Keypair.generate();
const stranger = Keypair.generate();
await fund(authority, oldWorker, newWorker, buyer, stranger, verifier);

const originalConfig = await account(c, "protocolConfig", config);
const changedFee =
  originalConfig.feeBps === 300 ? 299 : originalConfig.feeBps + 1;
await send(
  c,
  "updateProtocol",
  [
    changedFee,
    originalConfig.disputeSeconds,
    originalConfig.treasury,
    originalConfig.verifier,
    originalConfig.resolver,
  ],
  { admin: owner.publicKey, config },
);
assert.equal((await account(c, "protocolConfig", config)).feeBps, changedFee);

try {
  const pc = chain(authority);
  const newWc = chain(newWorker);
  const provider = pc.pda("provider", authority.publicKey);
  const oldWorkerAuth = pc.pda("worker", provider, oldWorker.publicKey);
  const newWorkerAuth = pc.pda("worker", provider, newWorker.publicKey);

  const metadataA = [...randomBytes(32)];
  const metadataB = [...randomBytes(32)];
  await send(pc, "registerProvider", [metadataA], {
    authority: authority.publicKey,
    config,
    provider,
  });
  await send(pc, "updateProvider", [metadataB, true], {
    authority: authority.publicKey,
    provider,
  });
  assert.deepEqual(
    [...(await account(c, "provider", provider)).metadataHash],
    metadataB,
  );
  await assert.rejects(
    send(chain(stranger), "updateProvider", [metadataA, false], {
      authority: stranger.publicKey,
      provider,
    }),
  );

  const mint = originalConfig.mint as PublicKey;
  const authorityToken = await getOrCreateAssociatedTokenAccount(
    c.connection,
    owner,
    mint,
    authority.publicKey,
  );
  const treasuryToken = await getOrCreateAssociatedTokenAccount(
    c.connection,
    owner,
    mint,
    originalConfig.treasury,
  );
  await mintTo(
    c.connection,
    owner,
    mint,
    authorityToken.address,
    owner,
    2_000n,
  );
  const stake = pc.pda("stake", provider);
  const stakeVault = pc.pda("stake-vault", provider);
  await send(pc, "initializeProviderStake", [], {
    authority: authority.publicKey,
    config,
    provider,
    mint,
    stake,
    vault: stakeVault,
  });
  await send(pc, "depositStake", [new BN(1_000)], {
    authority: authority.publicKey,
    provider,
    stake,
    mint,
    source: authorityToken.address,
    vault: stakeVault,
  });
  await send(pc, "requestUnstake", [new BN(700)], {
    authority: authority.publicKey,
    provider,
    stake,
  });
  await assert.rejects(
    send(pc, "withdrawStake", [], {
      authority: authority.publicKey,
      provider,
      stake,
      mint,
      vault: stakeVault,
      destination: authorityToken.address,
    }),
  );
  await assert.rejects(
    send(chain(stranger), "slashStake", [new BN(1)], {
      resolver: stranger.publicKey,
      config,
      provider,
      stake,
      mint,
      vault: stakeVault,
      treasury: treasuryToken.address,
    }),
  );
  await send(c, "slashStake", [new BN(400)], {
    resolver: owner.publicKey,
    config,
    provider,
    stake,
    mint,
    vault: stakeVault,
    treasury: treasuryToken.address,
  });
  const slashedStake = await account(c, "providerStake", stake);
  assert.equal(slashedStake.deposited.toString(), "600");
  assert.equal(slashedStake.pendingWithdrawal.toString(), "600");
  assert.equal(slashedStake.totalSlashed.toString(), "400");
  await send(pc, "cancelUnstake", [], {
    authority: authority.publicKey,
    provider,
    stake,
  });
  assert.equal(
    (await account(c, "providerStake", stake)).pendingWithdrawal.toString(),
    "0",
  );

  const expiresAt = new BN(Math.floor(Date.now() / 1000) + 86_400);
  await send(pc, "authorizeWorker", [expiresAt], {
    authority: authority.publicKey,
    provider,
    worker: oldWorker.publicKey,
    workerAuth: oldWorkerAuth,
  });
  await send(pc, "rotateWorker", [expiresAt], {
    authority: authority.publicKey,
    provider,
    oldWorkerAuth,
    newWorker: newWorker.publicKey,
    newWorkerAuth,
  });
  assert.equal(
    (await account(c, "workerAuthorization", oldWorkerAuth)).active,
    false,
  );
  assert.equal(
    (await account(c, "workerAuthorization", newWorkerAuth)).active,
    true,
  );

  const machineId = [...randomBytes(32)];
  const machine = pc.pda("machine", provider, Uint8Array.from(machineId));
  const hardwareA = [...randomBytes(32)];
  const hardwareB = [...randomBytes(32)];
  await send(pc, "registerMachine", [machineId, hardwareA, 1, 24_576], {
    authority: authority.publicKey,
    provider,
    workerAuth: newWorkerAuth,
    machine,
  });
  await send(pc, "updateMachine", [hardwareB, 1, 32_768], {
    authority: authority.publicKey,
    provider,
    machine,
    workerAuth: newWorkerAuth,
  });
  const updatedMachine = await account(c, "machine", machine);
  assert.equal(updatedMachine.vramMb, 32_768);
  assert.deepEqual([...updatedMachine.hardwareHash], hardwareB);

  const offerId = [...randomBytes(32)];
  const offer = pc.pda("offer", machine, Uint8Array.from(offerId));
  await send(pc, "createOffer", [offerId, new BN(100), 1, 600, expiresAt], {
    authority: authority.publicKey,
    provider,
    machine,
    offer,
  });
  await send(pc, "updateOffer", [new BN(125), 5, 900, expiresAt], {
    authority: authority.publicKey,
    provider,
    machine,
    offer,
  });
  assert.equal((await account(c, "offer", offer)).rate.toString(), "125");

  const buyerToken = await getOrCreateAssociatedTokenAccount(
    c.connection,
    owner,
    mint,
    buyer.publicKey,
  );
  await mintTo(c.connection, owner, mint, buyerToken.address, owner, 10_000n);
  const bc = chain(buyer);
  const jobId = [...randomBytes(32)];
  const job = bc.pda("job", buyer.publicKey, Uint8Array.from(jobId));
  const escrow = bc.pda("escrow", job);
  const deadline = Math.floor(Date.now() / 1000) + 300;
  await send(
    bc,
    "createJob",
    [jobId, [...randomBytes(32)], new BN(10_000), new BN(deadline), 60, 1],
    { buyer: buyer.publicKey, config, job, mint, escrow },
  );
  await send(bc, "fundJob", [], {
    buyer: buyer.publicKey,
    job,
    mint,
    source: buyerToken.address,
    escrow,
  });
  const bid = c.pda("bid", job, provider);
  await send(
    newWc,
    "placeBid",
    [
      new BN(8_000),
      new BN(Math.floor(Date.now() / 1000) + 2),
      new BN(deadline - 1),
    ],
    {
      worker: newWorker.publicKey,
      job,
      provider,
      workerAuth: newWorkerAuth,
      machine,
      bid,
    },
  );
  await send(newWc, "cancelBid", [], {
    worker: newWorker.publicKey,
    job,
    provider,
    workerAuth: newWorkerAuth,
    bid,
  });
  assert.equal((await account(c, "bid", bid)).active, false);
  await send(bc, "assignOffer", [], {
    buyer: buyer.publicKey,
    job,
    offer,
    machine,
    provider,
    workerAuth: newWorkerAuth,
  });
  const assigned = await account(c, "job", job);
  assert.equal(assigned.state, 4);
  assert.equal(assigned.price.toString(), "7500");
  await send(newWc, "startJob", [], {
    worker: newWorker.publicKey,
    job,
    workerAuth: newWorkerAuth,
  });
  const receiptHash = [...randomBytes(32)];
  await send(newWc, "submitReceipt", [receiptHash], {
    worker: newWorker.publicKey,
    job,
    workerAuth: newWorkerAuth,
  });
  await send(chain(verifier), "submitVerification", [receiptHash, true], {
    verifier: verifier.publicKey,
    job,
  });
  await new Promise((resolve) =>
    setTimeout(resolve, Number(originalConfig.disputeSeconds) * 1_000 + 1_100),
  );
  const payout = await getOrCreateAssociatedTokenAccount(
    c.connection,
    owner,
    mint,
    authority.publicKey,
  );
  await send(c, "settleJob", [], {
    job,
    mint,
    escrow,
    payout: payout.address,
    treasury: treasuryToken.address,
    refund: buyerToken.address,
    provider,
    machine,
  });
  assert.equal((await account(c, "job", job)).settled, true);

  await send(pc, "closeOffer", [], {
    authority: authority.publicKey,
    provider,
    machine,
    offer,
  });
  assert.equal(await c.connection.getAccountInfo(offer), null);
  await send(pc, "deactivateMachine", [], {
    authority: authority.publicKey,
    provider,
    machine,
  });
  assert.equal((await account(c, "machine", machine)).active, false);
  await send(pc, "updateProvider", [metadataB, false], {
    authority: authority.publicKey,
    provider,
  });
  assert.equal((await account(c, "provider", provider)).active, false);

  console.log("PASS: protocol and registry management lifecycle");
} finally {
  await send(
    c,
    "updateProtocol",
    [
      originalConfig.feeBps,
      originalConfig.disputeSeconds,
      originalConfig.treasury,
      originalConfig.verifier,
      originalConfig.resolver,
    ],
    { admin: owner.publicKey, config },
  );
}
