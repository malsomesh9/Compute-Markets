import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import {
  approve,
  getAccount,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from "@solana/spl-token";
import {
  account,
  BN,
  chain,
  keypair,
  Keypair,
  send,
} from "../packages/solana/client.ts";
import {
  buildSpecAllowlist,
  proofBytes,
} from "../packages/agent-policy/index.ts";

if (!process.env.SOLANA_RPC_URL?.includes("127.0.0.1")) {
  throw new Error("Agent policy E2E only runs on explicit localhost");
}

const admin = keypair("keys/local-admin.json");
const c = chain(admin);
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

const owner = Keypair.generate();
const agent = Keypair.generate();
const outsider = Keypair.generate();
await fund(owner, agent, outsider);

const protocol = await account(c, "protocolConfig", config);
const mint = protocol.mint;
const ownerToken = await getOrCreateAssociatedTokenAccount(
  c.connection,
  admin,
  mint,
  owner.publicKey,
);
await mintTo(c.connection, admin, mint, ownerToken.address, admin, 30_000n);
await approve(
  c.connection,
  admin,
  ownerToken.address,
  agent.publicKey,
  owner,
  15_000n,
);
const delegated = await getAccount(c.connection, ownerToken.address);
assert.equal(delegated.delegate?.equals(agent.publicKey), true);
assert.equal(delegated.delegatedAmount, 15_000n);

const allowedSpec = randomBytes(32).toString("hex");
const otherAllowedSpec = randomBytes(32).toString("hex");
const allowlist = buildSpecAllowlist([otherAllowedSpec, allowedSpec]);
const proof = proofBytes(allowlist.proofs[allowedSpec]!);
const root = [...Buffer.from(allowlist.root, "hex")];
const ownerChain = chain(owner);
const agentChain = chain(agent);
const outsiderChain = chain(outsider);
const policy = c.pda("agent-policy", owner.publicKey, agent.publicKey);
const expiry = Math.floor(Date.now() / 1000) + 3_600;

await send(
  ownerChain,
  "createAgentPolicy",
  [new BN(15_000), new BN(10_000), 120, 1, root, new BN(expiry)],
  {
    owner: owner.publicKey,
    agent: agent.publicKey,
    config,
    mint,
    agentPolicy: policy,
  },
);

const firstId = [...randomBytes(32)];
const firstJob = c.pda("job", owner.publicKey, Uint8Array.from(firstId));
const firstEscrow = c.pda("escrow", firstJob);
const deadline = Math.floor(Date.now() / 1000) + 300;
await send(
  agentChain,
  "createAgentJob",
  [
    firstId,
    [...Buffer.from(allowedSpec, "hex")],
    new BN(8_000),
    new BN(deadline),
    60,
    1,
    proof,
  ],
  {
    agent: agent.publicKey,
    owner: owner.publicKey,
    config,
    agentPolicy: policy,
    job: firstJob,
    mint,
    source: ownerToken.address,
    escrow: firstEscrow,
  },
);
const created = await account(c, "job", firstJob);
assert.equal(created.buyer.equals(owner.publicKey), true);
assert.equal(created.state, 2);
assert.equal(created.deposit.toString(), "8000");
assert.equal(
  (await account(c, "agentPolicy", policy)).dailySpent.toString(),
  "8000",
);

async function createAttempt(
  signer: ReturnType<typeof chain>,
  id: number[],
  hash: string,
  budget: number,
  merkleProof: number[][],
) {
  const job = c.pda("job", owner.publicKey, Uint8Array.from(id));
  return send(
    signer,
    "createAgentJob",
    [
      id,
      [...Buffer.from(hash, "hex")],
      new BN(budget),
      new BN(deadline),
      60,
      1,
      merkleProof,
    ],
    {
      agent: signer.signer.publicKey,
      owner: owner.publicKey,
      config,
      agentPolicy: policy,
      job,
      mint,
      source: ownerToken.address,
      escrow: c.pda("escrow", job),
    },
  );
}

await assert.rejects(
  createAttempt(agentChain, [...randomBytes(32)], allowedSpec, 8_000, proof),
  /Bounds|outside allowed bounds|6003/,
);
await assert.rejects(
  createAttempt(
    agentChain,
    [...randomBytes(32)],
    randomBytes(32).toString("hex"),
    1_000,
    proof,
  ),
);
await assert.rejects(
  createAttempt(outsiderChain, [...randomBytes(32)], allowedSpec, 1_000, proof),
);

await send(
  ownerChain,
  "updateAgentPolicy",
  [new BN(16_000), new BN(10_000), 120, 1, root, new BN(expiry)],
  { owner: owner.publicKey, agentPolicy: policy },
);
assert.equal(
  (await account(c, "agentPolicy", policy)).dailySpendLimit.toString(),
  "16000",
);

await send(agentChain, "cancelAgentJob", [proof], {
  agent: agent.publicKey,
  owner: owner.publicKey,
  agentPolicy: policy,
  job: firstJob,
});
await send(c, "refundJob", [], {
  job: firstJob,
  mint,
  escrow: firstEscrow,
  refund: ownerToken.address,
});
assert.equal((await account(c, "job", firstJob)).state, 14);
assert.equal(
  (await getAccount(c.connection, ownerToken.address)).amount,
  30_000n,
);

await send(ownerChain, "revokeAgentPolicy", [], {
  owner: owner.publicKey,
  agentPolicy: policy,
});
assert.equal((await account(c, "agentPolicy", policy)).active, false);
await assert.rejects(
  createAttempt(agentChain, [...randomBytes(32)], allowedSpec, 1_000, proof),
);

console.log(
  JSON.stringify({
    policy: policy.toBase58(),
    owner: owner.publicKey.toBase58(),
    agent: agent.publicKey.toBase58(),
    job: firstJob.toBase58(),
    root: allowlist.root,
    delegatedAndRefunded: true,
  }),
);
