import type { ComputeJobSpecV1 } from "../job-spec/index.ts";
import type { VerificationPolicy } from "../verification/policies.ts";
export type UnsignedTransaction = {
  transaction: string;
  blockhash: string;
  lastValidBlockHeight: number;
  rpcUrl?: string;
  jobId?: string;
  requiresWalletSignature: true;
};
export type TransactionSigner = (request: {
  action:
    | "create-and-fund"
    | "create-redundant"
    | "accept-bid"
    | "cancel"
    | "settle"
    | "create-agent-policy"
    | "update-agent-policy"
    | "revoke-agent-policy"
    | "agent-create-job"
    | "agent-accept-bid"
    | "agent-cancel";
  transaction: UnsignedTransaction;
}) => Promise<{ signature: string }>;

export type AgentPolicyInput = {
  agent: string;
  dailySpendLimit: string;
  singleJobLimit: string;
  delegatedAmount: string;
  maxRuntimeSeconds: number;
  requiredVerification: VerificationPolicy;
  allowedSpecs: ComputeJobSpecV1[];
  expiresAt: number;
};

export class ComputeJobHandle {
  constructor(
    readonly id: string,
    private client: ComputeClient,
  ) {}
  status() {
    return this.client.status(this.id);
  }
  wait(options?: { signal?: AbortSignal; timeoutMs?: number }) {
    return this.client.wait(this.id, options);
  }
  logs() {
    return this.client.logs(this.id);
  }
  result() {
    return this.client.result(this.id);
  }
  receipt() {
    return this.client.receipt(this.id);
  }
  verify() {
    return this.client.verify(this.id);
  }
  cancel() {
    return this.client.cancelAndSign(this.id);
  }
}

export class ComputeClient {
  constructor(
    private config: {
      apiUrl: string;
      accessToken: string | (() => string | Promise<string>);
      walletProof: string | (() => string | Promise<string>);
      signAndSendTransaction?: TransactionSigner;
    },
  ) {}
  private async credential(value: string | (() => string | Promise<string>)) {
    return typeof value === "function" ? await value() : value;
  }
  private async request<T = any>(path: string, body?: unknown): Promise<T> {
    const [accessToken, walletProof] = await Promise.all([
      this.credential(this.config.accessToken),
      this.credential(this.config.walletProof),
    ]);
    const r = await fetch(`${this.config.apiUrl}${path}`, {
      method: body ? "POST" : "GET",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
        "X-Wallet-Proof": walletProof,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const result = (await r.json()) as any;
    if (!r.ok) throw new Error(result.error ?? `HTTP ${r.status}`);
    return result;
  }
  findCompute(options: { limit?: number; cursor?: string } = {}) {
    const query = new URLSearchParams();
    if (options.limit != null) query.set("limit", String(options.limit));
    if (options.cursor) query.set("cursor", options.cursor);
    return this.request(`/v1/offers${query.size ? `?${query}` : ""}`);
  }
  quote(input: {
    spec: ComputeJobSpecV1;
    maxSpendBaseUnits: string;
    region?: string;
  }) {
    return this.request("/v1/quotes", input);
  }
  createJob(input: { spec: ComputeJobSpecV1; maxSpendBaseUnits: string }) {
    return this.request("/v1/jobs", input);
  }
  createRedundantJob(input: {
    spec: ComputeJobSpecV1;
    maxSpendPerReplicaBaseUnits: string;
    replicas: 2 | 3;
    requiredMatches: 2 | 3;
  }) {
    return this.request("/v1/jobs/redundant", input);
  }
  redundantJob(id: string) {
    return this.request(`/v1/redundant-jobs/${id}`);
  }
  agentPolicies() {
    return this.request("/v1/agent-policies");
  }
  createAgentPolicy(input: AgentPolicyInput) {
    return this.request("/v1/agent-policies", input);
  }
  updateAgentPolicy(input: AgentPolicyInput) {
    return this.request(`/v1/agent-policies/${input.agent}/update`, input);
  }
  revokeAgentPolicy(agent: string) {
    return this.request(`/v1/agent-policies/${agent}/revoke`, {});
  }
  createAgentJob(input: {
    agent: string;
    spec: ComputeJobSpecV1;
    maxSpendBaseUnits: string;
    proof: string[];
  }) {
    return this.request("/v1/agent/jobs", input);
  }
  acceptAgentBid(
    id: string,
    input: {
      agent: string;
      bidId: string;
      proof: string[];
    },
  ) {
    return this.request(`/v1/agent/jobs/${id}/accept-bid`, input);
  }
  cancelAgentJob(id: string, input: { agent: string; proof: string[] }) {
    return this.request(`/v1/agent/jobs/${id}/cancel`, input);
  }
  acceptBid(id: string, bidId: string) {
    return this.request(`/v1/jobs/${id}/accept-bid`, { bidId });
  }
  settleJob(id: string) {
    return this.request(`/v1/jobs/${id}/settle`, {});
  }
  refundJob(id: string) {
    return this.request(`/v1/jobs/${id}/refund`, {});
  }
  expireJob(id: string) {
    return this.request(`/v1/jobs/${id}/expire`, {});
  }
  bids(id: string) {
    return this.request(`/v1/jobs/${id}/bids`);
  }
  cancelJob(id: string) {
    return this.request(`/v1/jobs/${id}/cancel`, {});
  }
  status(id: string) {
    return this.request(`/v1/jobs/${id}`);
  }
  logs(id: string) {
    return this.request(`/v1/jobs/${id}/logs`);
  }
  result(id: string) {
    return this.request(`/v1/jobs/${id}/result`);
  }
  receipt(id: string) {
    return this.request(`/v1/jobs/${id}/receipt`);
  }
  verifications(id: string) {
    return this.request(`/v1/jobs/${id}/verifications`);
  }
  prices() {
    return this.request("/v1/prices");
  }
  async verify(id: string) {
    const [receipt, verifications] = await Promise.all([
      this.receipt(id),
      this.verifications(id),
    ]);
    return { receipt, verifications };
  }
  private async sign(
    action: Parameters<TransactionSigner>[0]["action"],
    transaction: UnsignedTransaction,
  ) {
    if (!this.config.signAndSendTransaction)
      throw new Error(
        `A signAndSendTransaction callback is required to ${action}`,
      );
    if (!transaction.requiresWalletSignature || !transaction.transaction)
      throw new Error("API did not return a valid unsigned transaction");
    return this.config.signAndSendTransaction({ action, transaction });
  }
  private async waitFor(
    id: string,
    predicate: (job: any) => boolean,
    timeoutMs: number,
    signal?: AbortSignal,
  ) {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
      signal?.throwIfAborted();
      const { job } = (await this.status(id)) as any;
      if (predicate(job)) return job;
      if (
        ["CANCELLED", "EXPIRED", "FAILED", "DISPUTED", "REFUNDED"].includes(
          job.state,
        )
      )
        throw new Error(`Job entered terminal state ${job.state}`);
      await delay(1500, signal);
    }
    throw new Error("Timed out waiting for job state");
  }
  async run(input: {
    spec: ComputeJobSpecV1;
    maxSpendBaseUnits: string;
    region?: string;
    bidTimeoutMs?: number;
    signal?: AbortSignal;
  }) {
    const quote = (await this.quote({
      spec: input.spec,
      maxSpendBaseUnits: input.maxSpendBaseUnits,
      region: input.region,
    })) as any;
    if (!quote.quotes?.length) throw new Error("No eligible compute supply");
    const created = (await this.createJob({
      spec: input.spec,
      maxSpendBaseUnits: input.maxSpendBaseUnits,
    })) as UnsignedTransaction & { jobId: string };
    await this.sign("create-and-fund", created);
    await this.waitFor(
      created.jobId,
      (job) => job.state === "OPEN",
      60000,
      input.signal,
    );
    const bidDeadline = Date.now() + (input.bidTimeoutMs ?? 120000);
    let bid: any;
    while (Date.now() < bidDeadline) {
      input.signal?.throwIfAborted();
      const response = (await this.bids(created.jobId)) as any;
      bid = response.bids?.[0];
      if (bid) break;
      await delay(1500, input.signal);
    }
    if (!bid) throw new Error("No provider bid arrived before the deadline");
    const acceptance = (await this.acceptBid(
      created.jobId,
      bid.id,
    )) as UnsignedTransaction;
    await this.sign("accept-bid", acceptance);
    await this.waitFor(
      created.jobId,
      (job) =>
        ["ASSIGNED", "RUNNING", "VERIFYING", "COMPLETED"].includes(job.state),
      60000,
      input.signal,
    );
    return new ComputeJobHandle(created.jobId, this);
  }
  async cancelAndSign(id: string) {
    const transaction = (await this.cancelJob(id)) as UnsignedTransaction;
    return this.sign("cancel", transaction);
  }
  async createRedundantJobAndSign(input: {
    spec: ComputeJobSpecV1;
    maxSpendPerReplicaBaseUnits: string;
    replicas: 2 | 3;
    requiredMatches: 2 | 3;
  }) {
    const plan = (await this.createRedundantJob(input)) as {
      groupId: string;
      jobIds: string[];
      totalBudgetBaseUnits: string;
      transactions: Array<UnsignedTransaction & { jobId: string }>;
    };
    if (plan.transactions.length !== input.replicas)
      throw new Error("API returned an incomplete redundant transaction plan");
    const signatures: string[] = [];
    for (const transaction of plan.transactions) {
      const signed = await this.sign("create-redundant", transaction);
      signatures.push(signed.signature);
    }
    return { ...plan, signatures };
  }
  async settleAndSign(id: string) {
    const transaction = (await this.settleJob(id)) as UnsignedTransaction;
    return this.sign("settle", transaction);
  }
  async createAgentPolicyAndSign(input: AgentPolicyInput) {
    const transaction = (await this.createAgentPolicy(
      input,
    )) as UnsignedTransaction;
    return this.sign("create-agent-policy", transaction);
  }
  async updateAgentPolicyAndSign(input: AgentPolicyInput) {
    const transaction = (await this.updateAgentPolicy(
      input,
    )) as UnsignedTransaction;
    return this.sign("update-agent-policy", transaction);
  }
  async revokeAgentPolicyAndSign(agent: string) {
    const transaction = (await this.revokeAgentPolicy(
      agent,
    )) as UnsignedTransaction;
    return this.sign("revoke-agent-policy", transaction);
  }
  async createAgentJobAndSign(input: {
    agent: string;
    spec: ComputeJobSpecV1;
    maxSpendBaseUnits: string;
    proof: string[];
  }) {
    const transaction = (await this.createAgentJob(
      input,
    )) as UnsignedTransaction & {
      jobId: string;
    };
    await this.sign("agent-create-job", transaction);
    return new ComputeJobHandle(transaction.jobId, this);
  }
  async acceptAgentBidAndSign(
    id: string,
    input: { agent: string; bidId: string; proof: string[] },
  ) {
    const transaction = (await this.acceptAgentBid(
      id,
      input,
    )) as UnsignedTransaction;
    return this.sign("agent-accept-bid", transaction);
  }
  async cancelAgentJobAndSign(
    id: string,
    input: { agent: string; proof: string[] },
  ) {
    const transaction = (await this.cancelAgentJob(
      id,
      input,
    )) as UnsignedTransaction;
    return this.sign("agent-cancel", transaction);
  }
  async wait(
    id: string,
    {
      signal,
      timeoutMs = 3600000,
    }: { signal?: AbortSignal; timeoutMs?: number } = {},
  ) {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
      signal?.throwIfAborted();
      const { job } = await this.status(id);
      if (
        [
          "COMPLETED",
          "CANCELLED",
          "EXPIRED",
          "FAILED",
          "DISPUTED",
          "REFUNDED",
        ].includes(job.state)
      )
        return job;
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          signal?.removeEventListener("abort", abort);
          resolve();
        }, 2000);
        function abort() {
          clearTimeout(timer);
          reject(signal?.reason ?? new Error("Aborted"));
        }
        signal?.addEventListener("abort", abort, { once: true });
      });
    }
    throw new Error("Timed out waiting for job");
  }
}
async function delay(ms: number, signal?: AbortSignal) {
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, ms);
    function abort() {
      clearTimeout(timer);
      reject(signal?.reason ?? new Error("Aborted"));
    }
    signal?.addEventListener("abort", abort, { once: true });
  });
}
export { verifyReceipt } from "../verification/index.ts";
