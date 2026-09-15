import { createSolanaRpc, address } from "@solana/kit";
import { chain, type Chain } from "../../../packages/solana/client.ts";
import { admin, checked } from "../../../packages/config/backend.ts";
import { policyFromCode } from "../../../packages/verification/policies.ts";
import { jobStates } from "../../../packages/types/index.ts";
import { EventParser } from "@coral-xyz/anchor";
const zero = "11111111111111111111111111111111";
const asKey = (value: any) => value?.toBase58?.() ?? String(value);
const hex = (value: any) => Buffer.from(value).toString("hex");
export function project(name: string, a: any, id: string, slot: number) {
  const base = { id, slot };
  switch (name[0]!.toUpperCase() + name.slice(1)) {
    case "Provider":
      return {
        table: "providers",
        row: {
          ...base,
          authority: asKey(a.authority),
          metadata_hash: hex(a.metadataHash),
          active: a.active,
          completed: a.completed.toString(),
          failed: a.failed.toString(),
          name: "Independent provider",
          updated_at: new Date().toISOString(),
        },
      };
    case "ProviderStake":
      return {
        table: "provider_stakes",
        row: {
          ...base,
          provider_id: asKey(a.provider),
          mint: asKey(a.mint),
          deposited: a.deposited.toString(),
          pending_withdrawal: a.pendingWithdrawal.toString(),
          unlock_at: Number(a.unlockAt),
          total_slashed: a.totalSlashed.toString(),
        },
      };
    case "AgentPolicy":
      return {
        table: "agent_policies",
        row: {
          ...base,
          owner_wallet: asKey(a.owner),
          agent: asKey(a.agent),
          mint: asKey(a.mint),
          daily_spend_limit: a.dailySpendLimit.toString(),
          single_job_limit: a.singleJobLimit.toString(),
          max_runtime_seconds: a.maxRuntimeSeconds,
          required_verification: a.requiredVerification,
          allowed_specs_root: hex(a.allowedSpecsRoot),
          expires_at: Number(a.expiresAt),
          day_index: Number(a.dayIndex),
          daily_spent: a.dailySpent.toString(),
          active: a.active,
        },
      };
    case "WorkerAuthorization":
      return {
        table: "workers",
        row: {
          ...base,
          provider_id: asKey(a.provider),
          worker: asKey(a.worker),
          active: a.active,
          expires_at: Number(a.expiresAt),
        },
      };
    case "Machine":
      return {
        table: "machines",
        row: {
          ...base,
          provider_id: asKey(a.provider),
          worker: asKey(a.worker),
          hardware_hash: hex(a.hardwareHash),
          gpu_model: "Undisclosed",
          region: "Undisclosed",
          trust_level: "CLAIMED",
          gpu_count: a.gpuCount,
          vram_mb: a.vramMb,
          active: a.active,
          busy: a.busy,
          completed: a.completed.toString(),
          failed: a.failed.toString(),
          updated_at: new Date().toISOString(),
        },
      };
    case "Offer":
      return {
        table: "offers",
        row: {
          ...base,
          machine_id: asKey(a.machine),
          rate_base_units_per_second: a.rate.toString(),
          min_seconds: a.minSeconds,
          max_seconds: a.maxSeconds,
          expires_at: Number(a.expiresAt),
          active: a.active,
        },
      };
    case "Job":
      return {
        table: "jobs",
        row: {
          ...base,
          buyer: asKey(a.buyer),
          spec_hash: hex(a.specHash),
          mint: asKey(a.mint),
          state: jobStates[a.state],
          budget: a.budget.toString(),
          deposit: a.deposit.toString(),
          price: a.price.toString(),
          provider_id: asKey(a.provider) === zero ? null : asKey(a.provider),
          machine_id: asKey(a.machine) === zero ? null : asKey(a.machine),
          worker: asKey(a.worker) === zero ? null : asKey(a.worker),
          receipt_hash: hex(a.receiptHash),
          provider_paid: a.providerPaid.toString(),
          fee_paid: a.feePaid.toString(),
          refunded: a.refunded.toString(),
          settled: a.settled,
          deadline: Number(a.deadline),
          started_at: Number(a.startedAt) || null,
          submitted_at: Number(a.submittedAt) || null,
          verified_at: Number(a.verifiedAt) || null,
          timeout_seconds: a.timeout,
          verification_policy: policyFromCode(a.policy),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      };
    case "Bid":
      return {
        table: "bids",
        row: {
          ...base,
          job_id: asKey(a.job),
          provider_id: asKey(a.provider),
          machine_id: asKey(a.machine),
          worker: asKey(a.worker),
          price: a.price.toString(),
          estimated_start: Number(a.estimatedStart),
          expires_at: Number(a.expiresAt),
          active: a.active,
        },
      };
    default:
      return null;
  }
}
export class Indexer {
  readonly c: Chain;
  readonly rpc;
  private running = false;
  private dirty = false;
  constructor(c = chain()) {
    this.c = c;
    this.rpc = createSolanaRpc(
      process.env.SOLANA_RPC_URL ?? "http://127.0.0.1:8899",
    );
  }
  async reconcile() {
    if (this.running) {
      this.dirty = true;
      return;
    }
    this.running = true;
    try {
      do {
        this.dirty = false;
        const response = await this.rpc
          .getProgramAccounts(address(this.c.program.programId.toBase58()), {
            commitment: "finalized",
            encoding: "base64",
            withContext: true,
          })
          .send();
        const rows = response.value
          .map((item) => {
            const bytes = Buffer.from(item.account.data[0], "base64");
            const definition = this.c.program.idl.accounts?.find((d) =>
              bytes
                .subarray(0, d.discriminator.length)
                .equals(Buffer.from(d.discriminator)),
            );
            if (!definition) return null;
            return project(
              definition.name,
              this.c.program.coder.accounts.decode(definition.name, bytes),
              String(item.pubkey),
              Number(response.context.slot),
            );
          })
          .filter((x) => x !== null);
        const order = [
          "providers",
          "provider_stakes",
          "agent_policies",
          "workers",
          "machines",
          "offers",
          "jobs",
          "bids",
        ];
        rows.sort((a, b) => order.indexOf(a!.table) - order.indexOf(b!.table));
        for (const item of rows)
          await checked(
            admin.database.rpc("apply_projection", {
              table_name: item!.table,
              row_data: item!.row,
            }),
          );
        await checked(
          admin.database.from("indexer_cursors").upsert([
            {
              id: "reconcile",
              slot: Number(response.context.slot),
              updated_at: new Date().toISOString(),
            },
          ]),
        );
      } while (this.dirty);
    } finally {
      this.running = false;
    }
  }
  async backfill() {
    const cursor = await checked(
      admin.database
        .from("indexer_cursors")
        .select("signature")
        .eq("id", "history")
        .maybeSingle(),
    );
    let before: string | undefined;
    let newest: string | undefined;
    let reached = false;
    // The history watermark is independent of live subscriptions. Advance only after
    // every page is persisted and authoritative accounts have reconciled successfully.
    while (!reached) {
      const batch = await this.c.connection.getSignaturesForAddress(
        this.c.program.programId,
        { limit: 1000, before },
        "finalized",
      );
      if (!batch.length) break;
      newest ??= batch[0]!.signature;
      const missing: Array<{
        signature: string;
        slot: number;
        processed: boolean;
        error: string | null;
        block_time: number | null;
        event_name: string | null;
        event_data: unknown;
      }> = [];
      for (const tx of batch) {
        if (tx.signature === cursor?.signature) {
          reached = true;
          break;
        }
        const decoded = await this.decodeTransaction(tx.signature);
        missing.push({
          signature: tx.signature,
          slot: tx.slot,
          processed: decoded.processed,
          error: decoded.error ?? (tx.err ? JSON.stringify(tx.err) : null),
          block_time: decoded.blockTime,
          event_name: decoded.events.length
            ? decoded.events.map((event) => event.name).join(",")
            : null,
          event_data: decoded.events,
        });
      }
      if (missing.length)
        await checked(
          admin.database.from("chain_events").upsert(missing, {
            onConflict: "signature",
            ignoreDuplicates: true,
          }),
        );
      if (batch.length < 1000) break;
      before = batch[batch.length - 1]!.signature;
    }
    await this.reconcile();
    await this.processPendingEvents();
    await this.recordPriceHistory();
    if (newest)
      await checked(
        admin.database.from("indexer_cursors").upsert([
          {
            id: "history",
            signature: newest,
            updated_at: new Date().toISOString(),
          },
        ]),
      );
  }
  private async decodeTransaction(signature: string) {
    try {
      const transaction = await this.c.connection.getTransaction(signature, {
        commitment: "finalized",
        maxSupportedTransactionVersion: 0,
      });
      if (!transaction)
        return {
          processed: false,
          error: "Finalized transaction unavailable",
          blockTime: null,
          events: [] as Array<{ name: string; data: unknown }>,
        };
      const parser = new EventParser(
        this.c.program.programId,
        this.c.program.coder,
      );
      const events = [
        ...parser.parseLogs(transaction.meta?.logMessages ?? []),
      ].map((event) => ({
        name: event.name,
        data: JSON.parse(
          JSON.stringify(
            event.data,
            (_key, value) =>
              value?.toBase58?.() ??
              (value?.constructor?.name === "BN" ? value.toString() : value),
          ),
        ),
      }));
      return {
        processed: true,
        error: null,
        blockTime: transaction.blockTime ?? null,
        events,
      };
    } catch (error) {
      return {
        processed: false,
        error: (error as Error).message.slice(0, 1000),
        blockTime: null,
        events: [] as Array<{ name: string; data: unknown }>,
      };
    }
  }
  async processPendingEvents() {
    const pending = await checked(
      admin.database
        .from("chain_events")
        .select("signature")
        .eq("processed", false)
        .order("slot", { ascending: true })
        .limit(100),
    );
    for (const row of pending ?? []) {
      const decoded = await this.decodeTransaction(row.signature);
      await checked(
        admin.database
          .from("chain_events")
          .update({
            processed: decoded.processed,
            error: decoded.error,
            block_time: decoded.blockTime,
            event_name: decoded.events.length
              ? decoded.events.map((event) => event.name).join(",")
              : null,
            event_data: decoded.events,
          })
          .eq("signature", row.signature),
      );
    }
  }
  async recordPriceHistory() {
    const [offers, machines, heartbeats, reports] = await Promise.all([
      checked(
        admin.database
          .from("offers")
          .select("id,machine_id,rate_base_units_per_second,active")
          .eq("active", true)
          .limit(1000),
      ),
      checked(
        admin.database
          .from("machines")
          .select("id,gpu_model,region,hardware_hash,active,busy")
          .limit(1000),
      ),
      checked(
        admin.database
          .from("heartbeats")
          .select("machine_id,timestamp,available_gpu_count")
          .limit(1000),
      ),
      checked(
        admin.database
          .from("hardware_reports")
          .select("hash,report")
          .limit(1000),
      ),
    ]);
    const now = Math.floor(Date.now() / 1000);
    const recordedAt = new Date(Math.floor(now / 300) * 300000).toISOString();
    const rows = (offers ?? []).flatMap((offer) => {
      const machine = machines?.find((item) => item.id === offer.machine_id);
      if (!machine?.active) return [];
      const heartbeat = heartbeats?.find(
        (item) => item.machine_id === machine.id,
      );
      const hardware = reports?.find(
        (item) => item.hash === machine.hardware_hash,
      )?.report;
      return [
        {
          offer_id: offer.id,
          gpu_model: hardware?.gpu?.[0]?.model ?? machine.gpu_model,
          region: machine.region,
          rate_base_units_per_second: String(offer.rate_base_units_per_second),
          available:
            !machine.busy &&
            !!heartbeat &&
            now - Number(heartbeat.timestamp) < 90 &&
            (hardware?.gpu?.length === 0 || heartbeat.available_gpu_count > 0),
          recorded_at: recordedAt,
        },
      ];
    });
    if (rows.length)
      await checked(
        admin.database.from("market_price_history").upsert(rows, {
          onConflict: "offer_id,recorded_at",
        }),
      );
  }
  async start() {
    await this.backfill();
    const subscription = this.c.connection.onProgramAccountChange(
      this.c.program.programId,
      () => {
        void this.reconcile().catch(console.error);
      },
      "finalized",
    );
    let pollActive = false;
    const timer = setInterval(() => {
      if (pollActive) return;
      pollActive = true;
      void this.backfill()
        .catch(console.error)
        .finally(() => {
          pollActive = false;
        });
    }, 15000);
    return async () => {
      clearInterval(timer);
      await this.c.connection.removeProgramAccountChangeListener(subscription);
    };
  }
}
