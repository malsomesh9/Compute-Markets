import assert from "node:assert/strict";
import { createClient } from "@insforge/sdk";
import { admin, checked } from "../packages/config/backend.ts";
const anon = createClient({
  baseUrl: process.env.INSFORGE_URL!,
  anonKey: process.env.INSFORGE_ANON_KEY!,
});
for (const table of [
  "jobs",
  "job_specs",
  "receipts",
  "verifications",
  "chain_events",
  "heartbeat_nonces",
  "agent_policies",
  "scheduler_leases",
  "redundant_job_groups",
  "redundant_job_replicas",
  "verification_challenges",
  "service_deployments",
  "distributed_jobs",
]) {
  const { data, error } = await anon.database.from(table).select("*").limit(1);
  assert.ok(error || !data?.length, `Anonymous read of ${table} must fail`);
}
for (const table of [
  "providers",
  "machines",
  "offers",
  "benchmark_reports",
  "market_price_history",
]) {
  const { error } = await anon.database
    .from(table)
    .insert([{ id: "unauthorized" }]);
  assert.ok(error, `Anonymous ${table} mutation must fail`);
}
const { error: rpcError } = await anon.database.rpc("apply_projection", {
  table_name: "providers",
  row_data: { id: "attacker" },
});
assert.ok(rpcError);
const { error: leaseRpcError } = await anon.database.rpc(
  "claim_scheduler_lease",
  {
    p_lease: "attacker",
    p_owner: "00000000-0000-4000-8000-000000000001",
    p_ttl_seconds: 15,
  },
);
assert.ok(leaseRpcError, "Anonymous callers must not claim scheduler leases");
const receipt = await checked(
  admin.database.from("receipts").select("storage_key").limit(1),
);
if (receipt?.length) {
  const { error } = await anon.storage
    .from("execution-evidence")
    .download(receipt[0]!.storage_key);
  assert.ok(error, "Evidence is private");
}
const publicProbeId = `security-probe-${Date.now()}`;
await checked(
  admin.database.from("providers").insert([
    {
      id: publicProbeId,
      authority: publicProbeId,
      name: "RLS probe",
      metadata_hash: "0".repeat(64),
    },
  ]),
);
try {
  const { data: pub, error: publicError } = await anon.database
    .from("providers")
    .select("id")
    .eq("id", publicProbeId);
  assert.equal(publicError, null);
  assert.deepEqual(pub?.map((row) => row.id), [publicProbeId]);
} finally {
  await checked(
    admin.database.from("providers").delete().eq("id", publicProbeId),
  );
}
for (const table of ["benchmark_reports", "market_price_history"]) {
  const { error } = await anon.database.from(table).select("id").limit(1);
  assert.equal(error, null, `${table} should be publicly readable`);
}
const apiUrl = process.env.COMPUTE_API_URL ?? "http://127.0.0.1:4000";
const unauthorized = await fetch(`${apiUrl}/v1/jobs`);
assert.equal(unauthorized.status, 401);
const pageResponse = await fetch(`${apiUrl}/v1/offers?limit=2`);
assert.equal(pageResponse.status, 200);
const firstPage = (await pageResponse.json()) as any;
assert.ok(firstPage.offers.length <= 2);
if (firstPage.nextCursor) {
  const nextResponse = await fetch(
    `${apiUrl}/v1/offers?limit=2&cursor=${encodeURIComponent(firstPage.nextCursor)}`,
  );
  assert.equal(nextResponse.status, 200);
  const secondPage = (await nextResponse.json()) as any;
  const firstIds = new Set(firstPage.offers.map((offer: any) => offer.id));
  assert.equal(
    secondPage.offers.some((offer: any) => firstIds.has(offer.id)),
    false,
  );
}
assert.equal((await fetch(`${apiUrl}/v1/offers?limit=101`)).status, 400);
console.log(
  "PASS: anonymous private reads, privileged mutation, projection RPC and evidence downloads denied; public paginated registry readable; private API requires auth",
);
