"use client";

import { useEffect, useState, type FormEvent } from "react";
import {
  ArrowUpRight,
  RefreshCw,
  ShieldCheck,
  Terminal,
  Wallet,
} from "lucide-react";
import { Connection, Transaction } from "@solana/web3.js";
import { Buffer } from "buffer";
import { api } from "../lib/backend";

const short = (value: string) =>
  value ? `${value.slice(0, 5)}…${value.slice(-4)}` : "—";
const dollars = (value: number) =>
  value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 3,
  });
const defaultSpec = JSON.stringify(
  {
    version: "1",
    runtime: "oci",
    image: {
      repository: "docker.io/library/alpine",
      digest:
        "sha256:14358309a308569c32bdc37e2e0e9694be33a9d99e68afb0f5ff33cc1f695dce",
    },
    command: ["/bin/sh", "-c", "echo agent-compute-ok"],
    resources: {
      gpu: { count: 0, minimumVramMb: 0, allowedModels: [] },
      cpuCores: 1,
      ramMb: 256,
      storageMb: 1024,
    },
    execution: { timeoutSeconds: 300, maxStartDelaySeconds: 60 },
    network: { mode: "deny-by-default", allow: [] },
    verification: { policy: "STANDARD" },
    inputs: [],
  },
  null,
  2,
);

async function signTransaction(built: any) {
  const wallet = (window as any).solana;
  if (!wallet?.signAndSendTransaction)
    throw new Error("Connect a Solana wallet first.");
  const result = await wallet.signAndSendTransaction(
    Transaction.from(Buffer.from(built.transaction, "base64")),
  );
  const confirmation = await new Connection(
    built.rpcUrl,
    "confirmed",
  ).confirmTransaction(
    {
      signature: result.signature,
      blockhash: built.blockhash,
      lastValidBlockHeight: built.lastValidBlockHeight,
    },
    "confirmed",
  );
  if (confirmation.value.err)
    throw new Error(
      `Transaction failed: ${JSON.stringify(confirmation.value.err)}`,
    );
  return result.signature as string;
}

export function AgentPolicies({
  connected,
  connect,
  notify,
}: {
  connected: boolean;
  connect: () => void;
  notify: (message: string) => void;
}) {
  const [policies, setPolicies] = useState<any[]>([]);
  const [agent, setAgent] = useState("");
  const [daily, setDaily] = useState("1.00");
  const [single, setSingle] = useState("0.10");
  const [runtime, setRuntime] = useState("300");
  const [days, setDays] = useState("30");
  const [specText, setSpecText] = useState(defaultSpec);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function refreshPolicies() {
    if (!connected) return;
    try {
      const response = await api("/v1/agent-policies");
      setPolicies(response.policies ?? []);
      setError("");
    } catch (caught) {
      setError((caught as Error).message);
    }
  }

  useEffect(() => {
    void refreshPolicies();
  }, [connected]);

  async function createPolicy(event: FormEvent) {
    event.preventDefault();
    if (!connected) {
      connect();
      return;
    }
    setBusy(true);
    setError("");
    try {
      const dailySpendLimit = Math.round(Number(daily) * 1e6);
      const singleJobLimit = Math.round(Number(single) * 1e6);
      if (dailySpendLimit <= 0 || singleJobLimit <= 0)
        throw new Error("Spending limits must be positive USDC amounts.");
      const built = await api("/v1/agent-policies", {
        agent: agent.trim(),
        dailySpendLimit: String(dailySpendLimit),
        singleJobLimit: String(singleJobLimit),
        delegatedAmount: String(dailySpendLimit),
        maxRuntimeSeconds: Number(runtime),
        requiredVerification: "STANDARD",
        allowedSpecs: [JSON.parse(specText)],
        expiresAt: Math.floor(Date.now() / 1000) + Number(days) * 24 * 60 * 60,
      });
      const signature = await signTransaction(built);
      notify(
        `Agent policy confirmed · ${short(signature)}. The indexer will publish it shortly.`,
      );
      window.setTimeout(() => void refreshPolicies(), 2500);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function revokePolicy(agentAddress: string) {
    setBusy(true);
    setError("");
    try {
      const built = await api(
        `/v1/agent-policies/${encodeURIComponent(agentAddress)}/revoke`,
        {},
      );
      const signature = await signTransaction(built);
      notify(`Agent policy revoked · ${short(signature)}.`);
      window.setTimeout(() => void refreshPolicies(), 2500);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="page-heading">
        <div className="eyebrow">BOUNDED AUTONOMOUS SPEND</div>
        <h1>Authorize an agent, on your terms.</h1>
        <p>
          Commit exact workloads and hard spending limits on Solana. Your owner
          key stays in your wallet.
        </p>
      </div>
      {!connected ? (
        <div className="empty-market">
          <Wallet size={30} />
          <h3>Connect the owner wallet</h3>
          <p>
            Wallet ownership is required to create, inspect, or revoke agent
            policies.
          </p>
          <button className="button primary" onClick={connect}>
            Connect wallet
          </button>
        </div>
      ) : (
        <>
          <div className="form-layout">
            <form className="panel" onSubmit={createPolicy}>
              <div className="panel-title">
                <ShieldCheck size={18} />
                <h2>New agent policy</h2>
                <span>OWNER SIGNATURE</span>
              </div>
              <div className="form-fields">
                <label>
                  Agent wallet
                  <input
                    required
                    placeholder="Solana public key"
                    value={agent}
                    onChange={(event) => setAgent(event.target.value)}
                  />
                </label>
                <div className="form-pair">
                  <label>
                    Daily limit (USDC)
                    <input
                      required
                      type="number"
                      min="0.000001"
                      step="0.000001"
                      value={daily}
                      onChange={(event) => setDaily(event.target.value)}
                    />
                  </label>
                  <label>
                    Per-job limit (USDC)
                    <input
                      required
                      type="number"
                      min="0.000001"
                      step="0.000001"
                      value={single}
                      onChange={(event) => setSingle(event.target.value)}
                    />
                  </label>
                </div>
                <div className="form-pair">
                  <label>
                    Maximum runtime (seconds)
                    <input
                      required
                      type="number"
                      min="1"
                      max="86400"
                      value={runtime}
                      onChange={(event) => setRuntime(event.target.value)}
                    />
                  </label>
                  <label>
                    Expires after (days)
                    <input
                      required
                      type="number"
                      min="1"
                      max="365"
                      value={days}
                      onChange={(event) => setDays(event.target.value)}
                    />
                  </label>
                </div>
                <label>
                  Allowed workload (canonical job spec JSON)
                  <textarea
                    required
                    rows={15}
                    spellCheck={false}
                    value={specText}
                    onChange={(event) => setSpecText(event.target.value)}
                  />
                  <small>
                    Changed images, commands, resources, or verification
                    settings require a policy update.
                  </small>
                </label>
                {error && <p className="form-error">{error}</p>}
                <button
                  disabled={busy}
                  className="button primary"
                  type="submit"
                >
                  {busy ? "Waiting for signature…" : "Create policy"}
                  <ArrowUpRight size={15} />
                </button>
              </div>
            </form>
            <aside>
              <div className="summary-card">
                <div className="eyebrow">ENFORCED BY SOLANA</div>
                <strong>
                  {dollars(Number(daily))}
                  <span>DAILY</span>
                </strong>
                <p>
                  The agent receives a capped SPL-token allowance. Policy checks
                  and daily accounting execute atomically on-chain.
                </p>
                <hr />
                <div>
                  <span>Per-job ceiling</span>
                  <b>{dollars(Number(single))}</b>
                </div>
                <div>
                  <span>Required assurance</span>
                  <b>STANDARD / VERIFY_1</b>
                </div>
                <div>
                  <span>Allowed workloads</span>
                  <b>Exact Merkle proof</b>
                </div>
              </div>
            </aside>
          </div>
          <div className="section-heading">
            <h2>
              Existing policies <span>{policies.length}</span>
            </h2>
            <button
              className="icon-button"
              aria-label="Refresh agent policies"
              onClick={refreshPolicies}
            >
              <RefreshCw size={14} />
            </button>
          </div>
          {!policies.length ? (
            <div className="empty-market">
              <Terminal size={30} />
              <h3>No indexed policies yet</h3>
              <p>
                Create one above or refresh after its transaction finalizes.
              </p>
            </div>
          ) : (
            <div className="panel">
              {policies.map((policy) => (
                <div className="job-row" key={policy.id}>
                  <Terminal size={20} />
                  <span>
                    {short(policy.agent)}
                    <small>
                      {policy.required_verification} ·{" "}
                      {policy.max_runtime_seconds}s maximum
                    </small>
                  </span>
                  <span
                    className={policy.active ? "online-pill" : "offline-pill"}
                  >
                    <i /> {policy.active ? "ACTIVE" : "REVOKED"}
                  </span>
                  <b>
                    {dollars(Number(policy.daily_spent) / 1e6)} /{" "}
                    {dollars(Number(policy.daily_spend_limit) / 1e6)}
                  </b>
                  <button
                    disabled={busy || !policy.active}
                    className="button secondary"
                    onClick={() => revokePolicy(policy.agent)}
                  >
                    Revoke
                  </button>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </>
  );
}
