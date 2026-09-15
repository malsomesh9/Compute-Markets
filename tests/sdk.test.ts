import { test } from "node:test";
import assert from "node:assert/strict";
import { ComputeClient } from "../packages/sdk/index.ts";
import { jobSpecSchema } from "../packages/job-spec/index.ts";

const spec = jobSpecSchema.parse({
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
});

test("SDK run performs quote, signed funding, bid acceptance and returns a handle", async () => {
  const originalFetch = globalThis.fetch;
  const requests: string[] = [];
  const signatures: string[] = [];
  globalThis.fetch = (async (
    url: string | URL | Request,
    init?: RequestInit,
  ) => {
    const parsed = new URL(String(url));
    const path = parsed.pathname;
    requests.push(`${init?.method ?? "GET"} ${path}${parsed.search}`);
    const payload =
      path === "/v1/quotes"
        ? { quotes: [{ totalBaseUnits: "10" }] }
        : path === "/v1/jobs" && init?.method === "POST"
          ? unsigned({ jobId: "job-1" })
          : path === "/v1/jobs/job-1/bids" && !init?.body
            ? { bids: [{ id: "bid-1" }] }
            : path === "/v1/jobs/job-1/accept-bid"
              ? unsigned({})
              : path === "/v1/jobs/job-1"
                ? {
                    job: {
                      state:
                        requests.filter((x) => x.endsWith(path)).length === 1
                          ? "OPEN"
                          : "ASSIGNED",
                    },
                  }
                : {};
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
  try {
    const client = new ComputeClient({
      apiUrl: "http://api.test",
      accessToken: async () => "token",
      walletProof: async () => "proof",
      signAndSendTransaction: async ({ action }) => {
        signatures.push(action);
        return { signature: `${action}-signature` };
      },
    });
    const job = await client.run({ spec, maxSpendBaseUnits: "100" });
    await client.findCompute({ limit: 25, cursor: "next-page" });
    assert.equal(job.id, "job-1");
    assert.deepEqual(signatures, ["create-and-fund", "accept-bid"]);
    assert.ok(requests.includes("POST /v1/jobs"));
    assert.ok(requests.includes("POST /v1/jobs/job-1/accept-bid"));
    assert.ok(requests.includes("GET /v1/offers?limit=25&cursor=next-page"));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

function unsigned(extra: Record<string, unknown>) {
  return {
    ...extra,
    transaction: "base64",
    blockhash: "blockhash",
    lastValidBlockHeight: 1,
    requiresWalletSignature: true,
  };
}
