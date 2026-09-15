import { storeReceipt } from "../../../packages/storage/index.ts";
import { Indexer } from "../../indexer/src/indexer.ts";
import { registry, requests, latency } from "./observability.ts";
import Fastify, { type FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import bs58 from "bs58";
import { trace } from "@opentelemetry/api";
import { Transaction } from "@solana/web3.js";
import { createApproveInstruction } from "@solana/spl-token";
import {
  admin,
  checked,
  userClient,
} from "../../../packages/config/backend.ts";
import { jobSpecSchema } from "../../../packages/job-spec/index.ts";
import {
  commitment,
  verifyPayload,
  receiptSchema,
} from "../../../packages/receipts/index.ts";
import { quoteSupply, type Supply } from "../../../packages/pricing/index.ts";
import { calculateReputation } from "../../../packages/reputation/index.ts";
import {
  buildSpecAllowlist,
  proofBytes,
  verifySpecProof,
} from "../../../packages/agent-policy/index.ts";
import {
  benchmarkPassed,
  benchmarkReportSchema,
} from "../../../packages/benchmark/index.ts";
import {
  policyCode,
  verificationPolicies,
} from "../../../packages/verification/policies.ts";
import {
  challengeResponseSchema,
  issueChallenge,
  verifyChallenge,
} from "../../../packages/verification/challenge.ts";
import {
  chain,
  account,
  PublicKey,
  instruction,
  BN,
  getAssociatedTokenAddressSync,
} from "../../../packages/solana/client.ts";
const publicKey = z.string().refine((v) => {
  try {
    return bs58.decode(v).length === 32;
  } catch {
    return false;
  }
}, "Invalid Solana address");
const baseUnits = z.string().regex(/^[1-9][0-9]{0,19}$/);
const hash32 = z.string().regex(/^[0-9a-fA-F]{64}$/);
const pageQuery = z.strictObject({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: publicKey.optional(),
});
const agentPolicyBody = z.strictObject({
  agent: publicKey,
  dailySpendLimit: baseUnits,
  singleJobLimit: baseUnits,
  delegatedAmount: baseUnits,
  maxRuntimeSeconds: z.number().int().min(1).max(86_400),
  requiredVerification: z.enum(verificationPolicies),
  allowedSpecs: z.array(jobSpecSchema).min(1).max(64),
  expiresAt: z.number().int(),
});
export async function createServer() {
  const publicReadOnly = process.env.PUBLIC_READ_ONLY === "true";
  const app = Fastify({
    logger: { redact: ["req.headers.authorization", "req.headers.cookie"] },
    bodyLimit: 65536,
    genReqId: () => randomUUID(),
  });
  await app.register(cors, {
    origin: (process.env.WEB_ORIGIN ?? "http://localhost:3000").split(","),
    allowedHeaders: ["Content-Type", "Authorization", "X-Wallet-Proof"],
  });
  await app.register(rateLimit, { max: 120, timeWindow: "1 minute" });
  app.addHook("preHandler", async (req, reply) => {
    if (
      publicReadOnly &&
      !["GET", "HEAD", "OPTIONS"].includes(req.method.toUpperCase())
    ) {
      return reply.code(503).send({
        error:
          "This deployment is a read-only preview until the Solana program and settlement mint are deployed.",
        requestId: req.id,
      });
    }
  });
  app.setErrorHandler((error: any, _req, reply) => {
    const status =
      error.statusCode ?? (error instanceof z.ZodError ? 400 : 500);
    const message =
      error instanceof z.ZodError
        ? error.issues
            .map(
              (issue) =>
                `${issue.path.join(".") || "request"}: ${issue.message}`,
            )
            .join("; ")
        : error.message;
    app.log.error({ err: error });
    reply.code(status).send({
      error: status < 500 ? message : "Request failed; check server logs",
      requestId: _req.id,
    });
  });
  async function identity(req: FastifyRequest) {
    const token = req.headers.authorization?.replace(/^Bearer /, "");
    if (!token)
      throw Object.assign(new Error("Sign in required"), { statusCode: 401 });
    const client = userClient(token);
    const { data, error } = await client.auth.getCurrentUser();
    if (error || !data?.user)
      throw Object.assign(new Error("Invalid session"), { statusCode: 401 });
    return { client, user: data.user };
  }
  async function wallet(req: FastifyRequest) {
    const { user } = await identity(req);
    let proof: any;
    try {
      proof = JSON.parse(
        Buffer.from(
          String(req.headers["x-wallet-proof"] ?? ""),
          "base64",
        ).toString(),
      );
    } catch {
      throw Object.assign(new Error("Wallet signature required"), {
        statusCode: 401,
      });
    }
    const expected = {
      domain: "vericompute:wallet-session:v1",
      userId: user.id,
      wallet: proof.payload?.wallet,
      expiresAt: proof.payload?.expiresAt,
    };
    if (
      !publicKey.safeParse(expected.wallet).success ||
      !Number.isInteger(expected.expiresAt) ||
      expected.expiresAt < Date.now() / 1000 ||
      expected.expiresAt > Date.now() / 1000 + 900 ||
      commitment(expected) !== commitment(proof.payload) ||
      !verifyPayload(expected, proof.signature, bs58.decode(expected.wallet))
    )
      throw Object.assign(new Error("Invalid or expired wallet proof"), {
        statusCode: 403,
      });
    return expected.wallet as string;
  }
  async function ownedJob(req: FastifyRequest, id: string) {
    publicKey.parse(id);
    const owner = await wallet(req);
    const job = await checked(
      admin.database.from("jobs").select("*").eq("id", id).maybeSingle(),
    );
    if (!job || job.buyer !== owner)
      throw Object.assign(new Error("Job not found"), { statusCode: 404 });
    return job;
  }
  async function supply(
    options: { limit?: number; after?: string } = {},
  ): Promise<Supply[]> {
    let offerQuery = admin.database
      .from("offers")
      .select(
        "id,machine_id,rate_base_units_per_second,min_seconds,max_seconds,expires_at,active",
      )
      .eq("active", true)
      .order("id", { ascending: true })
      .limit(options.limit ?? 1000);
    if (options.after) offerQuery = offerQuery.gt("id", options.after);
    const offers = await checked(offerQuery);
    if (!offers?.length) return [];
    const machineIds = [...new Set(offers.map((offer) => offer.machine_id))];
    const machines = await checked(
      admin.database
        .from("machines")
        .select(
          "id,provider_id,gpu_model,gpu_count,vram_mb,region,active,busy,completed,failed,hardware_hash",
        )
        .in("id", machineIds)
        .limit(machineIds.length),
    );
    const providerIds = [
      ...new Set((machines ?? []).map((machine) => machine.provider_id)),
    ];
    const hardwareHashes = [
      ...new Set((machines ?? []).map((machine) => machine.hardware_hash)),
    ];
    const [heartbeats, reports, jobs, benchmarks, stakes] = await Promise.all([
      checked(
        admin.database
          .from("heartbeats")
          .select("machine_id,timestamp,available_gpu_count")
          .in("machine_id", machineIds)
          .limit(machineIds.length),
      ),
      checked(
        admin.database
          .from("hardware_reports")
          .select("hash,report")
          .in("hash", hardwareHashes)
          .limit(hardwareHashes.length),
      ),
      checked(
        admin.database
          .from("jobs")
          .select(
            "id,provider_id,machine_id,state,deadline,timeout_seconds,started_at,submitted_at,updated_at",
          )
          .in("provider_id", providerIds)
          .limit(2000),
      ),
      checked(
        admin.database
          .from("benchmark_reports")
          .select("machine_id,passed,created_at")
          .eq("passed", true)
          .in("machine_id", machineIds)
          .limit(1000),
      ),
      checked(
        admin.database
          .from("provider_stakes")
          .select("provider_id,deposited")
          .in("provider_id", providerIds)
          .limit(providerIds.length),
      ),
    ]);
    const jobIds = (jobs ?? []).map((job) => job.id);
    const verifications = jobIds.length
      ? await checked(
          admin.database
            .from("verifications")
            .select("job_id,passed")
            .in("job_id", jobIds)
            .limit(jobIds.length),
        )
      : [];
    return offers.flatMap((o) => {
      const m = machines?.find((m) => m.id === o.machine_id);
      if (!m) return [];
      const hb = heartbeats?.find((h) => h.machine_id === m.id);
      const hardware = reports?.find((r) => r.hash === m.hardware_hash)?.report;
      const machineBenchmarked = benchmarks?.some(
        (benchmark) => benchmark.machine_id === m.id && benchmark.passed,
      );
      const reputation = calculateReputation({
        heartbeatAt: Number(hb?.timestamp ?? 0),
        benchmarkPassed: machineBenchmarked,
        jobs: (jobs ?? [])
          .filter((job) => job.provider_id === m.provider_id)
          .map((job) => ({
            state: job.state,
            deadline: Number(job.deadline),
            timeoutSeconds: job.timeout_seconds,
            startedAt: job.started_at == null ? null : Number(job.started_at),
            submittedAt:
              job.submitted_at == null ? null : Number(job.submitted_at),
            updatedAt: job.updated_at,
            verificationPassed: verifications?.find(
              (verification) => verification.job_id === job.id,
            )?.passed,
          })),
      });
      const machineReputation = calculateReputation({
        heartbeatAt: Number(hb?.timestamp ?? 0),
        benchmarkPassed: machineBenchmarked,
        jobs: (jobs ?? [])
          .filter((job) => job.machine_id === m.id)
          .map((job) => ({
            state: job.state,
            deadline: Number(job.deadline),
            timeoutSeconds: job.timeout_seconds,
            startedAt: job.started_at == null ? null : Number(job.started_at),
            submittedAt:
              job.submitted_at == null ? null : Number(job.submitted_at),
            updatedAt: job.updated_at,
            verificationPassed: verifications?.find(
              (verification) => verification.job_id === job.id,
            )?.passed,
          })),
      });
      return [
        {
          id: o.id,
          provider: m.provider_id,
          machine: m.id,
          gpuModel: hardware?.gpu?.[0]?.model ?? m.gpu_model,
          gpuCount: m.gpu_count,
          vramMb: m.vram_mb,
          region: m.region,
          rateBaseUnitsPerSecond: String(o.rate_base_units_per_second),
          reputation: reputation.score,
          stakeBaseUnits: String(
            stakes?.find((stake) => stake.provider_id === m.provider_id)
              ?.deposited ?? 0,
          ),
          reputationComponents: reputation.components,
          machineReputation: machineReputation.score,
          machineReputationComponents: machineReputation.components,
          trustLevel: machineBenchmarked ? "BENCHMARKED" : "CLAIMED",
          active: m.active && o.active,
          available:
            !publicReadOnly &&
            !m.busy &&
            !!hb &&
            (m.gpu_count === 0 || hb.available_gpu_count > 0),
          expiresAt: Number(o.expires_at),
          heartbeatAt: Number(hb?.timestamp ?? 0),
          estimatedStartSeconds: 10,
          verification: "STANDARD" as const,
          runtime: "oci" as const,
          maxSeconds: o.max_seconds,
        },
      ];
    });
  }
  app.addHook("onResponse", async (req, reply) => {
    const route = req.routeOptions.url ?? "unmatched";
    requests.inc({ route, status: String(reply.statusCode) });
    latency.observe({ route }, reply.elapsedTime / 1000);
  });
  app.get("/metrics", async (_req, reply) =>
    reply.type(registry.contentType).send(await registry.metrics()),
  );
  app.get("/health", async () => ({
    ok: true,
    service: "vericompute-api",
    settlement: "Solana only",
    requestTime: new Date().toISOString(),
  }));
  app.get("/ready", async (_req, reply) => {
    try {
      const c = chain();
      const [genesisHash, program, backend] = await Promise.all([
        c.connection.getGenesisHash(),
        c.connection.getAccountInfo(c.program.programId, "confirmed"),
        admin.database.from("providers").select("id").limit(1),
      ]);
      if (!program?.executable)
        throw new Error("Compute market program is not deployed");
      if (backend.error) throw backend.error;
      return {
        ok: true,
        network: process.env.SOLANA_NETWORK ?? "configured cluster",
        genesisHash,
        programId: c.program.programId.toBase58(),
        indexer: process.env.RUN_INDEXER === "true" ? "embedded" : "external",
      };
    } catch (error) {
      return reply.code(503).send({
        ok: false,
        error: (error as Error).message,
      });
    }
  });
  async function offerPage(query: unknown) {
    const page = pageQuery.parse(query);
    const rows = await supply({ limit: page.limit + 1, after: page.cursor });
    return {
      offers: rows.slice(0, page.limit),
      nextCursor: rows.length > page.limit ? rows[page.limit - 1]!.id : null,
    };
  }
  app.get("/v1/offers", async (req) => offerPage(req.query));
  app.get("/v1/markets", async (req) => offerPage(req.query));
  app.get("/v1/providers", async (req) => {
    const page = pageQuery.parse(req.query);
    let query = admin.database
      .from("providers")
      .select(
        "id,authority,name,active,completed,failed,provider_stakes(deposited,pending_withdrawal,unlock_at,total_slashed)",
      )
      .order("id", { ascending: true })
      .limit(page.limit + 1);
    if (page.cursor) query = query.gt("id", page.cursor);
    const rows = (await checked(query)) ?? [];
    return {
      providers: rows.slice(0, page.limit),
      nextCursor: rows.length > page.limit ? rows[page.limit - 1]!.id : null,
    };
  });
  app.get<{ Params: { id: string } }>("/v1/providers/:id", async (req) => ({
    provider: await checked(
      admin.database
        .from("providers")
        .select(
          "id,authority,name,active,completed,failed,metadata_hash,provider_stakes(deposited,pending_withdrawal,unlock_at,total_slashed,mint)",
        )
        .eq("id", publicKey.parse(req.params.id))
        .maybeSingle(),
    ),
  }));
  app.get<{ Params: { id: string } }>("/v1/machines/:id", async (req) => ({
    machine: await checked(
      admin.database
        .from("machines")
        .select("*")
        .eq("id", publicKey.parse(req.params.id))
        .maybeSingle(),
    ),
  }));
  app.get("/v1/network/stats", async () => {
    const [p, m, j, c] = await Promise.all([
      admin.database
        .from("providers")
        .select("id", { count: "exact", head: true }),
      admin.database
        .from("machines")
        .select("id", { count: "exact", head: true }),
      admin.database.from("jobs").select("id", { count: "exact", head: true }),
      admin.database
        .from("indexer_cursors")
        .select("slot,updated_at")
        .eq("id", "reconcile")
        .maybeSingle(),
    ]);
    for (const r of [p, m, j, c]) if (r.error) throw r.error;
    return {
      providers: p.count ?? 0,
      machines: m.count ?? 0,
      jobs: j.count ?? 0,
      lastIndexedSlot: c.data?.slot ?? null,
      lastIndexedAt: c.data?.updated_at ?? null,
      network:
        process.env.SOLANA_NETWORK ??
        (process.env.SOLANA_RPC_URL?.includes("127.0.0.1")
          ? "localnet"
          : "configured cluster"),
      mode: publicReadOnly ? "read-only-preview" : "live",
      settlementAsset: publicReadOnly ? "TEST USDC" : "USDC",
      programReady: !publicReadOnly,
    };
  });
  app.get("/v1/prices", async () => {
    const offers = await supply();
    const models = [...new Set(offers.map((o) => o.gpuModel))];
    return {
      prices: models.map((model) => {
        const listed = offers.filter((offer) => offer.gpuModel === model);
        const rates = offers
          .filter(
            (o) =>
              o.gpuModel === model &&
              o.available &&
              Date.now() / 1000 - o.heartbeatAt < 90,
          )
          .map((o) => (Number(o.rateBaseUnitsPerSecond) * 3600) / 1e6)
          .sort((a, b) => a - b);
        return {
          model,
          best: rates[0] ?? null,
          median: rates.length ? rates[Math.floor(rates.length / 2)] : null,
          p25: rates.length
            ? rates[Math.floor((rates.length - 1) * 0.25)]
            : null,
          p75: rates.length
            ? rates[Math.floor((rates.length - 1) * 0.75)]
            : null,
          supply: rates.length,
          listedSupply: listed.length,
          utilization: listed.length ? 1 - rates.length / listed.length : null,
        };
      }),
    };
  });
  app.post("/v1/quotes", async (req) => {
    const body = z
      .strictObject({
        spec: jobSpecSchema,
        maxSpendBaseUnits: z.string().regex(/^[1-9][0-9]{0,12}$/),
        region: z.string().optional(),
      })
      .parse(req.body);
    return {
      quotes: quoteSupply(
        await supply(),
        body.spec,
        BigInt(body.maxSpendBaseUnits),
        Math.floor(Date.now() / 1000),
        body.region,
      ),
      binding: false,
    };
  });
  app.get("/v1/specs", async (req) => {
    const { client } = await identity(req);
    return {
      specs: await checked(
        client.database
          .from("job_specs")
          .select("hash,name,created_at")
          .order("created_at", { ascending: false })
          .limit(50),
      ),
    };
  });
  app.post("/v1/specs", async (req) => {
    const { client } = await identity(req);
    const { name, spec } = z
      .strictObject({ name: z.string().min(1).max(100), spec: jobSpecSchema })
      .parse(req.body);
    const hash = commitment(spec);
    await checked(
      client.database.from("job_specs").insert([{ hash, name, spec }]),
    );
    return { hash };
  });
  app.get("/v1/agent-policies", async (req) => {
    const owner = await wallet(req);
    return {
      policies: await checked(
        admin.database
          .from("agent_policies")
          .select(
            "id,agent,mint,daily_spend_limit,single_job_limit,max_runtime_seconds,required_verification,allowed_specs_root,expires_at,day_index,daily_spent,active,slot",
          )
          .eq("owner_wallet", owner)
          .order("expires_at", { ascending: false })
          .limit(100),
      ),
    };
  });
  app.post("/v1/agent-policies", async (req) => {
    const ownerAddress = await wallet(req);
    const { client, user } = await identity(req);
    const body = agentPolicyBody.parse(req.body);
    const now = Math.floor(Date.now() / 1000);
    if (body.expiresAt <= now || body.expiresAt > now + 365 * 86_400)
      throw Object.assign(new Error("Policy expiry must be within one year"), {
        statusCode: 400,
      });
    if (
      BigInt(body.singleJobLimit) > BigInt(body.dailySpendLimit) ||
      BigInt(body.delegatedAmount) < BigInt(body.singleJobLimit)
    )
      throw Object.assign(new Error("Invalid policy spending limits"), {
        statusCode: 400,
      });

    const specHashes = body.allowedSpecs.map(commitment);
    const allowlist = buildSpecAllowlist(specHashes);
    await checked(
      client.database.from("job_specs").upsert(
        body.allowedSpecs.map((spec, index) => ({
          owner_id: user.id,
          hash: specHashes[index]!,
          name: "Agent policy workload",
          spec,
        })),
        { onConflict: "owner_id,hash", ignoreDuplicates: true },
      ),
    );
    const c = chain();
    const owner = new PublicKey(ownerAddress);
    const agent = new PublicKey(body.agent);
    const config = await account(c, "protocolConfig", c.pda("config"));
    const policy = c.pda("agent-policy", owner, agent);
    const approve = createApproveInstruction(
      getAssociatedTokenAddressSync(config.mint, owner),
      agent,
      owner,
      BigInt(body.delegatedAmount),
    );
    const create = await instruction(
      c,
      "createAgentPolicy",
      [
        new BN(body.dailySpendLimit),
        new BN(body.singleJobLimit),
        body.maxRuntimeSeconds,
        policyCode(body.requiredVerification),
        [...Buffer.from(allowlist.root, "hex")],
        new BN(body.expiresAt),
      ],
      {
        owner,
        agent,
        config: c.pda("config"),
        mint: config.mint,
        agentPolicy: policy,
      },
    );
    return {
      ...(await unsigned(c, ownerAddress, approve, create)),
      policyId: policy.toBase58(),
      allowlist,
    };
  });
  app.post<{ Params: { agent: string } }>(
    "/v1/agent-policies/:agent/update",
    async (req) => {
      const ownerAddress = await wallet(req);
      const { client, user } = await identity(req);
      const body = agentPolicyBody.parse(req.body);
      if (body.agent !== req.params.agent)
        throw Object.assign(new Error("Agent path and body must match"), {
          statusCode: 400,
        });
      const now = Math.floor(Date.now() / 1000);
      if (body.expiresAt <= now || body.expiresAt > now + 365 * 86_400)
        throw Object.assign(
          new Error("Policy expiry must be within one year"),
          {
            statusCode: 400,
          },
        );
      if (
        BigInt(body.singleJobLimit) > BigInt(body.dailySpendLimit) ||
        BigInt(body.delegatedAmount) < BigInt(body.singleJobLimit)
      )
        throw Object.assign(new Error("Invalid policy spending limits"), {
          statusCode: 400,
        });
      const specHashes = body.allowedSpecs.map(commitment);
      const allowlist = buildSpecAllowlist(specHashes);
      await checked(
        client.database.from("job_specs").upsert(
          body.allowedSpecs.map((spec, index) => ({
            owner_id: user.id,
            hash: specHashes[index]!,
            name: "Agent policy workload",
            spec,
          })),
          { onConflict: "owner_id,hash", ignoreDuplicates: true },
        ),
      );
      const c = chain();
      const owner = new PublicKey(ownerAddress);
      const agent = new PublicKey(body.agent);
      const policy = c.pda("agent-policy", owner, agent);
      const config = await account(c, "protocolConfig", c.pda("config"));
      const approve = createApproveInstruction(
        getAssociatedTokenAddressSync(config.mint, owner),
        agent,
        owner,
        BigInt(body.delegatedAmount),
      );
      const update = await instruction(
        c,
        "updateAgentPolicy",
        [
          new BN(body.dailySpendLimit),
          new BN(body.singleJobLimit),
          body.maxRuntimeSeconds,
          policyCode(body.requiredVerification),
          [...Buffer.from(allowlist.root, "hex")],
          new BN(body.expiresAt),
        ],
        { owner, agentPolicy: policy },
      );
      return {
        ...(await unsigned(c, ownerAddress, approve, update)),
        policyId: policy.toBase58(),
        allowlist,
      };
    },
  );
  app.post<{ Params: { agent: string } }>(
    "/v1/agent-policies/:agent/revoke",
    async (req) => {
      const ownerAddress = await wallet(req);
      const agent = new PublicKey(publicKey.parse(req.params.agent));
      const owner = new PublicKey(ownerAddress);
      const c = chain();
      const policy = c.pda("agent-policy", owner, agent);
      const ix = await instruction(c, "revokeAgentPolicy", [], {
        owner,
        agentPolicy: policy,
      });
      return unsigned(c, ownerAddress, ix);
    },
  );
  app.post("/v1/agent/jobs", async (req) => {
    const ownerAddress = await wallet(req);
    const { client, user } = await identity(req);
    const body = z
      .strictObject({
        agent: publicKey,
        spec: jobSpecSchema,
        maxSpendBaseUnits: baseUnits,
        proof: z.array(hash32).max(16),
      })
      .parse(req.body);
    const specHash = commitment(body.spec);
    const c = chain();
    const owner = new PublicKey(ownerAddress);
    const agent = new PublicKey(body.agent);
    const policyAddress = c.pda("agent-policy", owner, agent);
    const policy = await account(c, "agentPolicy", policyAddress);
    const root = Buffer.from(policy.allowedSpecsRoot).toString("hex");
    if (!verifySpecProof(specHash, body.proof, root))
      throw Object.assign(new Error("Spec is outside the agent policy"), {
        statusCode: 403,
      });
    await checked(
      client.database.from("job_specs").upsert(
        [
          {
            owner_id: user.id,
            hash: specHash,
            name: "Agent job",
            spec: body.spec,
          },
        ],
        { onConflict: "owner_id,hash", ignoreDuplicates: true },
      ),
    );
    const id = Buffer.from(randomUUID().replaceAll("-", "").repeat(2), "hex");
    const job = c.pda("job", owner, id);
    const config = await account(c, "protocolConfig", c.pda("config"));
    const ix = await instruction(
      c,
      "createAgentJob",
      [
        [...id],
        [...Buffer.from(specHash, "hex")],
        new BN(body.maxSpendBaseUnits),
        new BN(
          Math.floor(Date.now() / 1000) +
            body.spec.execution.maxStartDelaySeconds,
        ),
        body.spec.execution.timeoutSeconds,
        policyCode(body.spec.verification.policy),
        proofBytes(body.proof),
      ],
      {
        agent,
        owner,
        config: c.pda("config"),
        agentPolicy: policyAddress,
        job,
        mint: config.mint,
        source: getAssociatedTokenAddressSync(config.mint, owner),
        escrow: c.pda("escrow", job),
      },
    );
    return {
      ...(await unsigned(c, body.agent, ix)),
      jobId: job.toBase58(),
    };
  });
  app.post<{ Params: { id: string } }>(
    "/v1/agent/jobs/:id/accept-bid",
    async (req) => {
      const job = await ownedJob(req, req.params.id);
      const body = z
        .strictObject({
          agent: publicKey,
          bidId: publicKey,
          proof: z.array(hash32).max(16),
        })
        .parse(req.body);
      const c = chain();
      const owner = new PublicKey(job.buyer);
      const agent = new PublicKey(body.agent);
      const policy = c.pda("agent-policy", owner, agent);
      const bid = await account(c, "bid", new PublicKey(body.bidId));
      if (bid.job.toBase58() !== req.params.id)
        throw Object.assign(new Error("Bid belongs to a different job"), {
          statusCode: 400,
        });
      const ix = await instruction(
        c,
        "acceptAgentBid",
        [proofBytes(body.proof)],
        {
          agent,
          owner,
          agentPolicy: policy,
          job: new PublicKey(req.params.id),
          bid: new PublicKey(body.bidId),
          provider: bid.provider,
          machine: bid.machine,
          workerAuth: c.pda("worker", bid.provider, bid.worker),
        },
      );
      return unsigned(c, body.agent, ix);
    },
  );
  app.post<{ Params: { id: string } }>(
    "/v1/agent/jobs/:id/cancel",
    async (req) => {
      const job = await ownedJob(req, req.params.id);
      const body = z
        .strictObject({ agent: publicKey, proof: z.array(hash32).max(16) })
        .parse(req.body);
      const c = chain();
      const owner = new PublicKey(job.buyer);
      const agent = new PublicKey(body.agent);
      const ix = await instruction(
        c,
        "cancelAgentJob",
        [proofBytes(body.proof)],
        {
          agent,
          owner,
          agentPolicy: c.pda("agent-policy", owner, agent),
          job: new PublicKey(req.params.id),
        },
      );
      return unsigned(c, body.agent, ix);
    },
  );
  app.get("/v1/jobs", async (req) => {
    const owner = await wallet(req);
    return {
      jobs: await checked(
        admin.database
          .from("jobs")
          .select(
            "id,state,budget,deposit,price,provider_id,machine_id,settled,created_at,verification_policy",
          )
          .eq("buyer", owner)
          .order("created_at", { ascending: false })
          .limit(100),
      ),
    };
  });
  app.post("/v1/jobs", async (req) => {
    const owner = await wallet(req);
    const body = z
      .strictObject({
        spec: jobSpecSchema,
        maxSpendBaseUnits: z.string().regex(/^[1-9][0-9]{0,12}$/),
      })
      .parse(req.body);
    const { client, user } = await identity(req);
    await checked(
      client.database.from("job_specs").upsert(
        [
          {
            owner_id: user.id,
            hash: commitment(body.spec),
            name: "Compute intent",
            spec: body.spec,
          },
        ],
        { onConflict: "owner_id,hash", ignoreDuplicates: true },
      ),
    );
    const c = chain();
    const buyer = new PublicKey(owner);
    const id = Buffer.from(randomUUID().replaceAll("-", "").repeat(2), "hex");
    const job = c.pda("job", buyer, id);
    const config = await account(c, "protocolConfig", c.pda("config"));
    const ix = await instruction(
      c,
      "createJob",
      [
        Array.from(id),
        Array.from(Buffer.from(commitment(body.spec), "hex")),
        new BN(body.maxSpendBaseUnits),
        new BN(
          Math.floor(Date.now() / 1000) +
            body.spec.execution.maxStartDelaySeconds,
        ),
        body.spec.execution.timeoutSeconds,
        policyCode(body.spec.verification.policy),
      ],
      {
        buyer,
        config: c.pda("config"),
        job,
        mint: config.mint,
        escrow: c.pda("escrow", job),
      },
    );
    const fund = await instruction(c, "fundJob", [], {
      buyer,
      job,
      mint: config.mint,
      source: getAssociatedTokenAddressSync(config.mint, buyer),
      escrow: c.pda("escrow", job),
    });
    const latest = await c.connection.getLatestBlockhash();
    const tx = new Transaction({ feePayer: buyer, ...latest }).add(ix, fund);
    return {
      jobId: job.toBase58(),
      transaction: tx
        .serialize({ requireAllSignatures: false, verifySignatures: false })
        .toString("base64"),
      blockhash: latest.blockhash,
      lastValidBlockHeight: latest.lastValidBlockHeight,
      rpcUrl: process.env.SOLANA_RPC_URL,
      requiresWalletSignature: true,
    };
  });
  app.post("/v1/jobs/redundant", async (req) => {
    const owner = await wallet(req);
    const { client, user } = await identity(req);
    const body = z
      .strictObject({
        spec: jobSpecSchema,
        maxSpendPerReplicaBaseUnits: z.string().regex(/^[1-9][0-9]{0,12}$/),
        replicas: z.number().int().min(2).max(3),
        requiredMatches: z.number().int().min(2).max(3),
      })
      .parse(req.body);
    if (
      body.spec.verification.policy !== "REDUNDANT" ||
      body.requiredMatches > body.replicas
    )
      throw Object.assign(new Error("Invalid redundant verification plan"), {
        statusCode: 400,
      });
    const totalBudget =
      BigInt(body.maxSpendPerReplicaBaseUnits) * BigInt(body.replicas);
    if (totalBudget > 1_000_000_000_000n)
      throw Object.assign(
        new Error("Redundant job budget exceeds protocol cap"),
        {
          statusCode: 400,
        },
      );
    const specHash = commitment(body.spec);
    await checked(
      client.database.from("job_specs").upsert(
        [
          {
            owner_id: user.id,
            hash: specHash,
            name: "Redundant compute intent",
            spec: body.spec,
          },
        ],
        { onConflict: "owner_id,hash", ignoreDuplicates: true },
      ),
    );
    const c = chain();
    const buyer = new PublicKey(owner);
    const config = await account(c, "protocolConfig", c.pda("config"));
    const latest = await c.connection.getLatestBlockhash();
    const jobIds: string[] = [];
    const transactions: Array<{
      jobId: string;
      transaction: string;
      blockhash: string;
      lastValidBlockHeight: number;
      rpcUrl: string | undefined;
      requiresWalletSignature: true;
    }> = [];
    for (let ordinal = 0; ordinal < body.replicas; ordinal++) {
      const id = Buffer.from(randomUUID().replaceAll("-", "").repeat(2), "hex");
      const job = c.pda("job", buyer, id);
      jobIds.push(job.toBase58());
      const create = await instruction(
        c,
        "createJob",
        [
          Array.from(id),
          Array.from(Buffer.from(specHash, "hex")),
          new BN(body.maxSpendPerReplicaBaseUnits),
          new BN(
            Math.floor(Date.now() / 1000) +
              body.spec.execution.maxStartDelaySeconds,
          ),
          body.spec.execution.timeoutSeconds,
          policyCode("REDUNDANT"),
        ],
        {
          buyer,
          config: c.pda("config"),
          job,
          mint: config.mint,
          escrow: c.pda("escrow", job),
        },
      );
      const fund = await instruction(c, "fundJob", [], {
        buyer,
        job,
        mint: config.mint,
        source: getAssociatedTokenAddressSync(config.mint, buyer),
        escrow: c.pda("escrow", job),
      });
      const tx = new Transaction({ feePayer: buyer, ...latest }).add(
        create,
        fund,
      );
      transactions.push({
        jobId: job.toBase58(),
        transaction: tx
          .serialize({ requireAllSignatures: false, verifySignatures: false })
          .toString("base64"),
        blockhash: latest.blockhash,
        lastValidBlockHeight: latest.lastValidBlockHeight,
        rpcUrl: process.env.SOLANA_RPC_URL,
        requiresWalletSignature: true,
      });
    }
    const groupId = randomUUID();
    await checked(
      admin.database.from("redundant_job_groups").insert([
        {
          id: groupId,
          owner_id: user.id,
          buyer: owner,
          spec_hash: specHash,
          required_matches: body.requiredMatches,
        },
      ]),
    );
    await checked(
      admin.database.from("redundant_job_replicas").insert(
        jobIds.map((jobId, ordinal) => ({
          group_id: groupId,
          job_id: jobId,
          ordinal,
        })),
      ),
    );
    return {
      groupId,
      jobIds,
      totalBudgetBaseUnits: totalBudget.toString(),
      transactions,
    };
  });
  app.get<{ Params: { id: string } }>("/v1/redundant-jobs/:id", async (req) => {
    const owner = await wallet(req);
    const group = await checked(
      admin.database
        .from("redundant_job_groups")
        .select("*")
        .eq("id", z.string().uuid().parse(req.params.id))
        .eq("buyer", owner)
        .maybeSingle(),
    );
    if (!group)
      throw Object.assign(new Error("Redundant job not found"), {
        statusCode: 404,
      });
    return {
      group,
      replicas: await checked(
        admin.database
          .from("redundant_job_replicas")
          .select("*")
          .eq("group_id", group.id)
          .order("ordinal", { ascending: true })
          .limit(5),
      ),
    };
  });
  app.get<{ Params: { id: string } }>("/v1/jobs/:id", async (req) => ({
    job: await ownedJob(req, req.params.id),
  }));
  app.post<{ Params: { id: string } }>("/v1/jobs/:id/cancel", async (req) => {
    const job = await ownedJob(req, req.params.id);
    const c = chain();
    const ix = await instruction(c, "cancelJob", [], {
      buyer: new PublicKey(job.buyer),
      job: new PublicKey(req.params.id),
    });
    return unsigned(c, job.buyer, ix);
  });

  app.get<{ Params: { id: string } }>("/v1/jobs/:id/bids", async (req) => {
    await ownedJob(req, req.params.id);
    return {
      bids: await checked(
        admin.database
          .from("bids")
          .select(
            "id,provider_id,machine_id,worker,price,expires_at,estimated_start",
          )
          .eq("job_id", req.params.id)
          .eq("active", true)
          .order("price", { ascending: true })
          .limit(100),
      ),
    };
  });
  app.post<{ Params: { id: string } }>(
    "/v1/jobs/:id/accept-bid",
    async (req) => {
      const j = await ownedJob(req, req.params.id),
        body = z.strictObject({ bidId: publicKey }).parse(req.body),
        c = chain();
      const bid = await account(c, "bid", new PublicKey(body.bidId));
      if (bid.job.toBase58() !== req.params.id)
        throw Object.assign(new Error("Bid belongs to a different job"), {
          statusCode: 400,
        });
      const replica = await checked(
        admin.database
          .from("redundant_job_replicas")
          .select("group_id")
          .eq("job_id", req.params.id)
          .maybeSingle(),
      );
      if (replica) {
        const siblings = await checked(
          admin.database
            .from("redundant_job_replicas")
            .select("provider_id")
            .eq("group_id", replica.group_id)
            .limit(5),
        );
        if (
          siblings?.some(
            (sibling) => sibling.provider_id === bid.provider.toBase58(),
          )
        )
          throw Object.assign(
            new Error("Redundant replicas require independent providers"),
            { statusCode: 409 },
          );
      }
      const ix = await instruction(c, "acceptBid", [], {
        buyer: new PublicKey(j.buyer),
        job: new PublicKey(j.id),
        bid: new PublicKey(body.bidId),
        provider: bid.provider,
        machine: bid.machine,
        workerAuth: c.pda("worker", bid.provider, bid.worker),
      });
      return unsigned(c, j.buyer, ix);
    },
  );
  app.post<{ Params: { id: string } }>("/v1/jobs/:id/settle", async (req) => {
    const j = await ownedJob(req, req.params.id),
      c = chain(),
      onchain = await account(c, "job", new PublicKey(j.id));
    const ix = await instruction(c, "settleJob", [], {
      job: new PublicKey(j.id),
      mint: onchain.mint,
      escrow: c.pda("escrow", new PublicKey(j.id)),
      payout: getAssociatedTokenAddressSync(onchain.mint, onchain.payout),
      treasury: getAssociatedTokenAddressSync(onchain.mint, onchain.treasury),
      refund: getAssociatedTokenAddressSync(onchain.mint, onchain.buyer),
      provider: onchain.provider,
      machine: onchain.machine,
    });
    return unsigned(c, j.buyer, ix);
  });
  app.post<{ Params: { id: string } }>("/v1/jobs/:id/refund", async (req) => {
    const j = await ownedJob(req, req.params.id),
      c = chain(),
      job = new PublicKey(j.id);
    const onchain = await account(c, "job", job);
    return unsigned(
      c,
      j.buyer,
      await instruction(c, "refundJob", [], {
        job,
        mint: onchain.mint,
        escrow: c.pda("escrow", job),
        refund: getAssociatedTokenAddressSync(onchain.mint, onchain.buyer),
      }),
    );
  });
  app.post<{ Params: { id: string } }>("/v1/jobs/:id/expire", async (req) => {
    const j = await ownedJob(req, req.params.id),
      c = chain();
    return unsigned(
      c,
      j.buyer,
      await instruction(c, "expireJob", [], { job: new PublicKey(j.id) }),
    );
  });
  for (const field of ["receipt", "verifications", "result", "logs"] as const)
    app.get<{ Params: { id: string } }>(
      `/v1/jobs/:id/${field}`,
      async (req) => {
        await ownedJob(req, req.params.id);
        if (field === "verifications")
          return {
            verifications: await checked(
              admin.database
                .from("verifications")
                .select(
                  "receipt_hash,verifier,passed,assurance,failures,tx_signature",
                )
                .eq("job_id", req.params.id)
                .limit(10),
            ),
          };
        const row = await checked(
          admin.database
            .from("receipts")
            .select("envelope,storage_key")
            .eq("job_id", req.params.id)
            .maybeSingle(),
        );
        if (!row) return { status: "pending" };
        if (field === "receipt") return { receipt: row.envelope };
        const blob = await checked(
          admin.storage.from("execution-evidence").download(row.storage_key),
        );
        const evidence = JSON.parse(await blob!.text());
        return field === "result"
          ? { result: evidence.result }
          : { stdout: evidence.stdout, stderr: evidence.stderr };
      },
    );
  app.post("/v1/provider/benchmark", async (req) => {
    const envelope = z
      .strictObject({
        payload: benchmarkReportSchema,
        signature: z.string().max(100),
      })
      .parse(req.body);
    const report = envelope.payload;
    const c = chain();
    const now = Math.floor(Date.now() / 1000);
    const allowedDigests = new Set(
      (
        process.env.BENCHMARK_IMAGE_DIGESTS ??
        "sha256:14358309a308569c32bdc37e2e0e9694be33a9d99e68afb0f5ff33cc1f695dce"
      )
        .split(",")
        .filter(Boolean),
    );
    if (
      report.program !== c.program.programId.toBase58() ||
      report.cluster !== (await c.connection.getGenesisHash()) ||
      report.finishedAt < report.startedAt ||
      Math.abs(now - report.finishedAt) > 120 ||
      !allowedDigests.has(report.imageDigest) ||
      !verifyPayload(report, envelope.signature, bs58.decode(report.worker))
    )
      throw Object.assign(new Error("Invalid benchmark report"), {
        statusCode: 403,
      });
    const machine = await account(
      c,
      "machine",
      new PublicKey(report.machineId),
    );
    const authorization = await account(
      c,
      "workerAuthorization",
      c.pda("worker", machine.provider, new PublicKey(report.worker)),
    );
    if (
      machine.worker.toBase58() !== report.worker ||
      !authorization.active ||
      Number(authorization.expiresAt) <= now ||
      Buffer.from(machine.hardwareHash).toString("hex") !==
        report.hardwareReportHash ||
      report.gpu.length !== machine.gpuCount
    )
      throw Object.assign(new Error("Benchmark assignment mismatch"), {
        statusCode: 403,
      });
    const hardware = await checked(
      admin.database
        .from("hardware_reports")
        .select("report")
        .eq("hash", report.hardwareReportHash)
        .eq("machine_id", report.machineId)
        .maybeSingle(),
    );
    const expectedGpu = (hardware?.report?.gpu ?? []).map(
      (gpu: any) => gpu.uuid,
    );
    if (
      expectedGpu.length !== report.gpu.length ||
      report.gpu.some((gpu, index) => gpu.uuid !== expectedGpu[index])
    )
      throw Object.assign(new Error("Benchmark GPU identity mismatch"), {
        statusCode: 403,
      });
    const passed = benchmarkPassed(report);
    const id = commitment(report);
    await checked(
      admin.database.from("benchmark_reports").upsert(
        [
          {
            id,
            machine_id: report.machineId,
            worker: report.worker,
            hardware_report_hash: report.hardwareReportHash,
            image_digest: report.imageDigest,
            report,
            signature: envelope.signature,
            passed,
          },
        ],
        { onConflict: "id", ignoreDuplicates: true },
      ),
    );
    return {
      accepted: true,
      id,
      passed,
      trustLevel: passed ? "BENCHMARKED" : "CLAIMED",
    };
  });

  app.get<{ Params: { id: string } }>("/v1/jobs/:id/events", async (req) => {
    await ownedJob(req, req.params.id);
    const rows = await checked(
      admin.database
        .from("chain_events")
        .select("signature,slot,block_time,event_name,event_data,error")
        .order("slot", { ascending: true })
        .limit(1000),
    );
    return {
      events: (rows ?? []).flatMap((row) =>
        (Array.isArray(row.event_data) ? row.event_data : [])
          .filter((event: any) => event?.data?.job === req.params.id)
          .map((event: any) => ({
            signature: row.signature,
            slot: Number(row.slot),
            blockTime: row.block_time == null ? null : Number(row.block_time),
            name: event.name,
            data: event.data,
          })),
      ),
    };
  });

  app.get("/v1/provider/intents", async () => ({
    intents: await checked(
      admin.database
        .from("jobs")
        .select(
          "id,spec_hash,budget,deadline,timeout_seconds,verification_policy",
        )
        .eq("state", "OPEN")
        .limit(100),
    ),
  }));

  app.post("/v1/provider/job-spec", async (req) => {
    const envelope = z
      .strictObject({
        payload: z.strictObject({
          version: z.literal("1"),
          domain: z.literal("vericompute:job-spec-request:v1"),
          jobId: publicKey,
          worker: publicKey,
          provider: publicKey,
          timestamp: z.number().int(),
        }),
        signature: z.string(),
      })
      .parse(req.body);
    const p = envelope.payload,
      c = chain();
    if (
      Math.abs(Date.now() / 1000 - p.timestamp) > 30 ||
      !verifyPayload(p, envelope.signature, bs58.decode(p.worker))
    )
      throw Object.assign(new Error("Invalid worker proof"), {
        statusCode: 403,
      });
    const auth = await account(
      c,
      "workerAuthorization",
      c.pda("worker", new PublicKey(p.provider), new PublicKey(p.worker)),
    );
    if (!auth.active || Number(auth.expiresAt) < Date.now() / 1000)
      throw Object.assign(new Error("Worker delegation inactive"), {
        statusCode: 403,
      });
    const j = await account(c, "job", new PublicKey(p.jobId));
    if (j.state !== 2 && j.worker.toBase58() !== p.worker)
      throw Object.assign(new Error("Not assigned to this worker"), {
        statusCode: 403,
      });
    const hash = Buffer.from(j.specHash).toString("hex");
    const rows = await checked(
      admin.database.from("job_specs").select("spec").eq("hash", hash).limit(1),
    );
    if (!rows?.length)
      throw Object.assign(new Error("Job spec not available"), {
        statusCode: 404,
      });
    return { spec: rows[0]!.spec };
  });
  app.post("/v1/provider/heartbeat", async (req) => {
    const body = z
      .strictObject({
        payload: z.strictObject({
          version: z.literal("1"),
          domain: z.literal("vericompute:heartbeat:v1"),
          cluster: z.string(),
          program: publicKey,
          machineId: publicKey,
          worker: publicKey,
          timestamp: z.number().int(),
          availableGpuCount: z.number().int().min(0).max(16),
          load: z.number().min(0).max(1),
          runningJobs: z.array(publicKey).max(16),
          benchmarkHash: z.string(),
          nonce: z.string().uuid(),
        }),
        signature: z.string(),
      })
      .parse(req.body);
    const p = body.payload,
      c = chain();
    if (
      p.program !== c.program.programId.toBase58() ||
      p.cluster !== (await c.connection.getGenesisHash()) ||
      Math.abs(Date.now() / 1000 - p.timestamp) > 60 ||
      !verifyPayload(p, body.signature, bs58.decode(p.worker))
    )
      throw Object.assign(new Error("Invalid heartbeat"), { statusCode: 403 });
    const machine = await account(c, "machine", new PublicKey(p.machineId));
    const auth = await account(
      c,
      "workerAuthorization",
      c.pda("worker", machine.provider, new PublicKey(p.worker)),
    );
    if (
      machine.worker.toBase58() !== p.worker ||
      !auth.active ||
      Number(auth.expiresAt) < Date.now() / 1000 ||
      p.availableGpuCount > machine.gpuCount
    )
      throw Object.assign(new Error("Worker not authorized"), {
        statusCode: 403,
      });
    await checked(
      admin.database.rpc("record_heartbeat", {
        p_machine: p.machineId,
        p_worker: p.worker,
        p_time: p.timestamp,
        p_available: p.availableGpuCount,
        p_load: p.load,
        p_nonce: p.nonce,
      }),
    );
    return { accepted: true };
  });

  app.post<{ Params: { id: string } }>(
    "/v1/provider/jobs/:id/challenge",
    async (req) => {
      const envelope = z
        .strictObject({
          payload: z.strictObject({
            version: z.literal("1"),
            domain: z.literal("vericompute:challenge-request:v1"),
            jobId: publicKey,
            worker: publicKey,
            timestamp: z.number().int(),
            nonce: z.string().uuid(),
          }),
          signature: z.string().max(100),
        })
        .parse(req.body);
      const p = envelope.payload;
      if (
        p.jobId !== req.params.id ||
        Math.abs(Date.now() / 1000 - p.timestamp) > 60 ||
        !verifyPayload(p, envelope.signature, bs58.decode(p.worker))
      )
        throw Object.assign(new Error("Invalid challenge request"), {
          statusCode: 403,
        });
      const c = chain();
      const job = await account(c, "job", new PublicKey(p.jobId));
      if (
        job.state !== 8 ||
        job.policy !== policyCode("CHALLENGE") ||
        job.worker.toBase58() !== p.worker
      )
        throw Object.assign(new Error("Job is not awaiting a challenge"), {
          statusCode: 409,
        });
      const existing = await checked(
        admin.database
          .from("verification_challenges")
          .select("challenge,expires_at")
          .eq("job_id", p.jobId)
          .maybeSingle(),
      );
      if (existing && new Date(existing.expires_at).getTime() > Date.now())
        return { challenge: existing.challenge };
      const issued = issueChallenge({
        jobId: p.jobId,
        machineId: job.machine.toBase58(),
        worker: p.worker,
      });
      await checked(
        admin.database.from("verification_challenges").upsert(
          [
            {
              id: issued.challenge.id,
              job_id: p.jobId,
              machine_id: job.machine.toBase58(),
              worker: p.worker,
              challenge: issued.challenge,
              expected_result_hash: issued.expectedResultHash,
              response: null,
              response_signature: null,
              passed: null,
              expires_at: new Date(
                issued.challenge.expiresAt * 1000,
              ).toISOString(),
            },
          ],
          { onConflict: "job_id" },
        ),
      );
      return { challenge: issued.challenge };
    },
  );

  app.post<{ Params: { id: string } }>(
    "/v1/provider/jobs/:id/challenge-response",
    async (req) => {
      const envelope = z
        .strictObject({
          payload: challengeResponseSchema,
          signature: z.string().max(100),
        })
        .parse(req.body);
      if (envelope.payload.jobId !== req.params.id)
        throw Object.assign(new Error("Challenge job mismatch"), {
          statusCode: 400,
        });
      const [stored, receipt] = await Promise.all([
        checked(
          admin.database
            .from("verification_challenges")
            .select("challenge,expected_result_hash,passed")
            .eq("job_id", req.params.id)
            .maybeSingle(),
        ),
        checked(
          admin.database
            .from("receipts")
            .select("envelope")
            .eq("job_id", req.params.id)
            .maybeSingle(),
        ),
      ]);
      if (!stored)
        throw Object.assign(new Error("Challenge not found"), {
          statusCode: 404,
        });
      if (!receipt)
        throw Object.assign(new Error("Execution receipt not found"), {
          statusCode: 409,
        });
      if (stored.passed != null)
        return { accepted: true, passed: stored.passed, replay: true };
      const decision = verifyChallenge({
        challenge: stored.challenge,
        expectedResultHash: stored.expected_result_hash,
        expectedGpuUuidCommitment: receipt.envelope.payload.gpuUuidCommitment,
        expectedTelemetryHash: receipt.envelope.payload.telemetryHash,
        response: envelope.payload,
        signature: envelope.signature,
      });
      await checked(
        admin.database
          .from("verification_challenges")
          .update({
            response: envelope.payload,
            response_signature: envelope.signature,
            passed: decision.passed,
          })
          .eq("job_id", req.params.id)
          .is("passed", null),
      );
      return { accepted: true, ...decision };
    },
  );

  app.post(
    "/v1/provider/jobs/:id/result",
    { bodyLimit: 5 * 1024 * 1024 },
    async (req) => {
      const bundle = z
        .strictObject({
          envelope: z.strictObject({
            payload: receiptSchema,
            signature: z.string().max(100),
          }),
          spec: jobSpecSchema,
          evidence: z.strictObject({
            stdout: z.string().max(1400000),
            stderr: z.string().max(1400000),
            result: z.string().max(1400000),
            telemetry: z.strictObject({
              gpuUuids: z.array(z.string()).max(16),
              samples: z.number().int().nonnegative(),
              peakVramMb: z.number().nonnegative(),
              durationSeconds: z.number().nonnegative(),
            }),
            hardware: z.unknown(),
          }),
        })
        .parse(req.body);
      const c = chain(),
        p = bundle.envelope.payload,
        id = publicKey.parse((req.params as any).id);
      if (
        id !== p.jobId ||
        p.program !== c.program.programId.toBase58() ||
        p.cluster !== (await c.connection.getGenesisHash()) ||
        !verifyPayload(p, bundle.envelope.signature, bs58.decode(p.worker))
      )
        throw Object.assign(new Error("Invalid receipt envelope"), {
          statusCode: 403,
        });
      const info = await c.connection.getAccountInfo(
        new PublicKey(id),
        "finalized",
      );
      if (!info || !info.owner.equals(c.program.programId))
        throw Object.assign(new Error("Wait for finalized job"), {
          statusCode: 409,
        });
      const j = c.program.coder.accounts.decode("job", info.data) as any;
      if (
        j.state !== 8 ||
        j.worker.toBase58() !== p.worker ||
        Buffer.from(j.receiptHash).toString("hex") !== commitment(p) ||
        Buffer.from(j.specHash).toString("hex") !== commitment(bundle.spec)
      )
        throw Object.assign(
          new Error("Receipt not finalized or assignment mismatch"),
          { statusCode: 409 },
        );
      await new Indexer(c).reconcile();
      await storeReceipt(bundle);
      return { accepted: true, verification: "pending" };
    },
  );
  return app;
}
function serializeIx(ix: any) {
  return {
    programId: ix.programId.toBase58(),
    keys: ix.keys.map((k: any) => ({
      pubkey: k.pubkey.toBase58(),
      isSigner: k.isSigner,
      isWritable: k.isWritable,
    })),
    data: ix.data.toString("base64"),
  };
}

async function unsigned(
  c: ReturnType<typeof chain>,
  payer: string,
  ...ixs: any[]
) {
  const latest = await c.connection.getLatestBlockhash();
  const tx = new Transaction({ feePayer: new PublicKey(payer), ...latest }).add(
    ...ixs,
  );
  return {
    transaction: tx
      .serialize({ requireAllSignatures: false, verifySignatures: false })
      .toString("base64"),
    ...latest,
    requiresWalletSignature: true,
  };
}
