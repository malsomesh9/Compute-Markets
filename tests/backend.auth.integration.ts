import assert from "node:assert/strict";
import { createPrivateKey, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createClient } from "@insforge/sdk";
import { Keypair, Transaction } from "@solana/web3.js";
import { commitment, signPayload } from "../packages/receipts/index.ts";
import { chain } from "../packages/solana/client.ts";

const baseUrl = process.env.INSFORGE_URL!;
const anonKey = process.env.INSFORGE_ANON_KEY!;
const apiUrl = "http://127.0.0.1:4000";
const runSql = (sql: string) =>
  execFileSync("npx", ["-y", "@insforge/cli", "db", "query", sql, "--json"], {
    cwd: process.cwd(),
    stdio: "pipe",
    maxBuffer: 1024 * 1024,
  });
const querySql = <T>(sql: string) =>
  (JSON.parse(runSql(sql).toString()) as { rows: T[] }).rows;
const unique = `${Date.now()}-${randomBytes(4).toString("hex")}`;
const accounts = [
  {
    email: `vc-security-a-${unique}@example.invalid`,
    password: `A-${randomBytes(16).toString("hex")}`,
  },
  {
    email: `vc-security-b-${unique}@example.invalid`,
    password: `B-${randomBytes(16).toString("hex")}`,
  },
];
const clients = accounts.map(() => createClient({ baseUrl, anonKey }));
const userIds: string[] = [];

function privateKey(keypair: Keypair) {
  return createPrivateKey({
    key: Buffer.concat([
      Buffer.from("302e020100300506032b657004220420", "hex"),
      Buffer.from(keypair.secretKey.subarray(0, 32)),
    ]),
    format: "der",
    type: "pkcs8",
  });
}

function walletProof(
  userId: string,
  keypair: Keypair,
  expiresAt = Math.floor(Date.now() / 1000) + 300,
) {
  const payload = {
    domain: "vericompute:wallet-session:v1",
    userId,
    wallet: keypair.publicKey.toBase58(),
    expiresAt,
  };
  return Buffer.from(
    JSON.stringify(signPayload(payload, privateKey(keypair))),
  ).toString("base64");
}

async function api(
  path: string,
  token: string,
  proof?: string,
  body?: unknown,
) {
  return fetch(`${apiUrl}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(proof ? { "X-Wallet-Proof": proof } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function submitUnsigned(payload: any, signer: Keypair) {
  const local = chain(signer);
  const transaction = Transaction.from(
    Buffer.from(payload.transaction, "base64"),
  );
  transaction.partialSign(signer);
  const signature = await local.connection.sendRawTransaction(
    transaction.serialize(),
  );
  await local.connection.confirmTransaction(
    {
      signature,
      blockhash: payload.blockhash,
      lastValidBlockHeight: payload.lastValidBlockHeight,
    },
    "confirmed",
  );
  return signature;
}

try {
  for (let i = 0; i < clients.length; i++) {
    const { error } = await clients[i]!.auth.signUp(accounts[i]!);
    assert.equal(error, null, `Test user ${i + 1} signup failed`);
  }
  const created = querySql<{ id: string; email: string }>(
    `SELECT id,email FROM auth.users WHERE email IN ('${accounts.map((account) => account.email).join("','")}')`,
  );
  for (const account of accounts) {
    const user = created.find((row) => row.email === account.email);
    assert.ok(user?.id);
    userIds.push(user.id);
  }
  assert.ok(userIds.every((id) => /^[0-9a-f-]{36}$/i.test(id)));
  runSql(
    `UPDATE auth.users SET email_verified=true WHERE id IN ('${userIds.join("','")}')`,
  );

  const tokens: string[] = [];
  for (let i = 0; i < clients.length; i++) {
    const { data, error } = await clients[i]!.auth.signInWithPassword(
      accounts[i]!,
    );
    assert.equal(error, null, `Test user ${i + 1} signin failed`);
    assert.ok(data?.accessToken);
    tokens.push(data.accessToken);
  }

  const sharedHash = commitment({ tenantIsolation: true });
  for (let i = 0; i < clients.length; i++) {
    const { error } = await clients[i]!.database.from("job_specs").insert([
      {
        hash: sharedHash,
        name: `private-${i}`,
        spec: { tenant: i },
      },
    ]);
    assert.equal(error, null);
  }
  for (let i = 0; i < clients.length; i++) {
    const { data, error } = await clients[i]!.database.from("job_specs")
      .select("owner_id,name")
      .eq("hash", sharedHash);
    assert.equal(error, null);
    assert.deepEqual(
      data?.map((row) => row.owner_id),
      [userIds[i]],
    );
    assert.deepEqual(
      data?.map((row) => row.name),
      [`private-${i}`],
    );
  }
  const { error: impersonation } = await clients[1]!.database
    .from("job_specs")
    .insert([
      {
        owner_id: userIds[0],
        hash: commitment({ forged: true }),
        name: "forged",
        spec: {},
      },
    ]);
  assert.ok(
    impersonation,
    "A tenant must not insert rows owned by another tenant",
  );

  const { error: receiptRead } = await clients[0]!.database
    .from("receipts")
    .select("*")
    .limit(1);
  assert.ok(
    receiptRead,
    "Authenticated users must use the proof-gated API for receipts",
  );
  const { error: eventRead } = await clients[0]!.database
    .from("chain_events")
    .select("*")
    .limit(1);
  assert.ok(
    eventRead,
    "Authenticated users must use the proof-gated API for chain events",
  );
  const { error: projection } = await clients[0]!.database.rpc(
    "apply_projection",
    {
      table_name: "providers",
      row_data: { id: "forged" },
    },
  );
  assert.ok(
    projection,
    "Authenticated users must not invoke indexer projection RPCs",
  );
  const { error: evidence } = await clients[0]!.storage
    .from("execution-evidence")
    .download("untrusted/path.json");
  assert.ok(
    evidence,
    "Authenticated users must not bypass evidence authorization",
  );

  const buyer = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(readFileSync("keys/buyer.json", "utf8"))),
  );
  const stranger = Keypair.generate();
  const buyerJobs = await api(
    "/v1/jobs",
    tokens[0]!,
    walletProof(userIds[0]!, buyer),
  );
  assert.equal(buyerJobs.status, 200);
  const owned = (await buyerJobs.json()).jobs as Array<{ id: string }>;
  assert.ok(
    owned.length > 0,
    "The buyer wallet should see its finalized test job",
  );
  const timeline = await api(
    `/v1/jobs/${owned[0]!.id}/events`,
    tokens[0]!,
    walletProof(userIds[0]!, buyer),
  );
  assert.equal(timeline.status, 200);
  assert.ok(((await timeline.json()).events as unknown[]).length > 0);
  const hidden = await api(
    `/v1/jobs/${owned[0]!.id}`,
    tokens[1]!,
    walletProof(userIds[1]!, stranger),
  );
  assert.equal(hidden.status, 404);
  const crossUserProof = await api(
    "/v1/jobs",
    tokens[0]!,
    walletProof(userIds[1]!, buyer),
  );
  assert.equal(crossUserProof.status, 403);
  const expired = await api(
    "/v1/jobs",
    tokens[0]!,
    walletProof(userIds[0]!, buyer, Math.floor(Date.now() / 1000) - 1),
  );
  assert.equal(expired.status, 403);

  const agent = Keypair.generate();
  const local = chain(buyer);
  const airdrop = await local.connection.requestAirdrop(agent.publicKey, 2e9);
  const airdropBlockhash = await local.connection.getLatestBlockhash();
  await local.connection.confirmTransaction(
    { ...airdropBlockhash, signature: airdrop },
    "confirmed",
  );
  const agentSpec = {
    version: "1",
    runtime: "oci",
    image: {
      repository: "docker.io/library/alpine",
      digest: `sha256:${"a".repeat(64)}`,
    },
    command: ["true"],
    resources: {
      gpu: { count: 0, minimumVramMb: 0, allowedModels: [] },
      cpuCores: 1,
      ramMb: 128,
      storageMb: 64,
    },
    execution: { timeoutSeconds: 10, maxStartDelaySeconds: 30 },
    network: { mode: "deny-by-default", allow: [] },
    verification: { policy: "STANDARD" },
    inputs: [],
  };
  const policyResponse = await api(
    "/v1/agent-policies",
    tokens[0]!,
    walletProof(userIds[0]!, buyer),
    {
      agent: agent.publicKey.toBase58(),
      dailySpendLimit: "100",
      singleJobLimit: "50",
      delegatedAmount: "100",
      maxRuntimeSeconds: 20,
      requiredVerification: "STANDARD",
      allowedSpecs: [agentSpec],
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
    },
  );
  assert.equal(policyResponse.status, 200);
  const policyPayload = await policyResponse.json();
  await submitUnsigned(policyPayload, buyer);

  const agentJobResponse = await api(
    "/v1/agent/jobs",
    tokens[0]!,
    walletProof(userIds[0]!, buyer),
    {
      agent: agent.publicKey.toBase58(),
      spec: agentSpec,
      maxSpendBaseUnits: "1",
      proof: policyPayload.allowlist.proofs[commitment(agentSpec)],
    },
  );
  assert.equal(agentJobResponse.status, 200);
  const agentJobPayload = await agentJobResponse.json();
  await submitUnsigned(agentJobPayload, agent);
  assert.ok(agentJobPayload.jobId);

  const revokeResponse = await api(
    `/v1/agent-policies/${agent.publicKey.toBase58()}/revoke`,
    tokens[0]!,
    walletProof(userIds[0]!, buyer),
    {},
  );
  assert.equal(revokeResponse.status, 200);
  await submitUnsigned(await revokeResponse.json(), buyer);

  console.log(
    "PASS: authenticated RLS isolation, wallet ownership gates, and API-built owner/agent Solana transactions",
  );
} finally {
  const ids = userIds.filter((id) => /^[0-9a-f-]{36}$/i.test(id));
  if (ids.length) {
    runSql(
      `DELETE FROM public.job_specs WHERE owner_id IN ('${ids.join("','")}'); DELETE FROM public.saved_offers WHERE owner_id IN ('${ids.join("','")}'); DELETE FROM auth.users WHERE id IN ('${ids.join("','")}')`,
    );
  } else {
    runSql(
      `DELETE FROM auth.users WHERE email IN ('${accounts.map((account) => account.email).join("','")}')`,
    );
  }
}
