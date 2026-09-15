"use client";
import { useEffect, useState, useMemo, useRef, type FormEvent } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  ArrowUpRight,
  ArrowRight,
  ChevronDown,
  Search,
  SlidersHorizontal,
  LayoutGrid,
  List,
  Command,
  Plus,
  Activity,
  Box,
  Cpu,
  Globe,
  ShieldCheck,
  Terminal,
  Wallet,
  X,
  Check,
  Copy,
  RefreshCw,
  Server,
  BookOpen,
  ArrowDown,
  ExternalLink,
  CheckCircle2,
  Clock,
  Menu,
  LogOut,
} from "lucide-react";
import { Transaction, Connection } from "@solana/web3.js";
import { Buffer } from "buffer";
import { api, getBackend } from "../lib/backend";
import { authenticate, logout } from "../app/actions";
import { AgentPolicies } from "./agent-policies";
type Offer = {
  id: string;
  provider: string;
  machine: string;
  gpuModel: string;
  gpuCount: number;
  vramMb: number;
  rateBaseUnitsPerSecond: string;
  region: string;
  reputation: number;
  active: boolean;
  available: boolean;
  heartbeatAt: number;
  verification: string;
  trustLevel: "CLAIMED" | "BENCHMARKED";
  expiresAt: number;
  estimatedStartSeconds: number;
};
const short = (s: string) => (s ? `${s.slice(0, 5)}…${s.slice(-4)}` : "—");
const dollars = (n: number) =>
  n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 3,
  });
const nav = [
  ["Market", "/market"],
  ["My jobs", "/jobs"],
  ["Agents", "/agents"],
  ["Providers", "/providers"],
  ["Network", "/network"],
];
export function Exchange() {
  const path = usePathname(),
    router = useRouter();
  const [offers, setOffers] = useState<Offer[]>([]),
    [stats, setStats] = useState<any>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [query, setQuery] = useState(""),
    [gpu, setGpu] = useState("All GPUs"),
    [vram, setVram] = useState("Any VRAM"),
    [available, setAvailable] = useState(false),
    [sort, setSort] = useState("Lowest price"),
    [view, setView] = useState("list"),
    [modal, setModal] = useState(false),
    [user, setUser] = useState<any>(null),
    [wallet, setWallet] = useState(""),
    [notice, setNotice] = useState(""),
    [nextOfferCursor, setNextOfferCursor] = useState<string | null>(null),
    [menu, setMenu] = useState(false);
  const market = path === "/" || path === "/market";
  async function refresh() {
    setLoading(true);
    setError("");
    try {
      const [o, s] = await Promise.all([
        api("/v1/offers"),
        api("/v1/network/stats"),
      ]);
      setOffers(o.offers);
      setNextOfferCursor(o.nextCursor ?? null);
      setStats(s);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  async function loadMoreOffers() {
    if (!nextOfferCursor) return;
    setLoading(true);
    setError("");
    try {
      const page = await api(
        `/v1/offers?limit=50&cursor=${encodeURIComponent(nextOfferCursor)}`,
      );
      setOffers((current) => {
        const byId = new Map(current.map((offer) => [offer.id, offer]));
        for (const offer of page.offers) byId.set(offer.id, offer);
        return [...byId.values()];
      });
      setNextOfferCursor(page.nextCursor ?? null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void refresh();
    if (document.cookie.includes("insforge_access_token="))
      void getBackend()
        .auth.getCurrentUser()
        .then(({ data }) => setUser(data?.user ?? null));
  }, []);
  useEffect(() => {
    if (!notice) return;
    const id = setTimeout(() => setNotice(""), 5000);
    return () => clearTimeout(id);
  }, [notice]);
  useEffect(() => {
    const restore = () => {
      try {
        const proof = JSON.parse(
          atob(sessionStorage.getItem("vc-wallet-proof") ?? ""),
        );
        setWallet(
          proof.payload.userId === user?.id &&
            proof.payload.expiresAt > Date.now() / 1000
            ? proof.payload.wallet
            : "",
        );
      } catch {
        setWallet("");
      }
    };
    restore();
    const timer = setInterval(restore, 15000);
    return () => clearInterval(timer);
  }, [user]);
  async function connect() {
    try {
      if (!user) {
        setModal(true);
        return;
      }
      const solana = (window as any).solana;
      if (!solana?.connect)
        throw new Error(
          "Install a Solana wallet with message signing to connect.",
        );
      const result = await solana.connect();
      const address = result.publicKey.toString();
      const payload = {
        domain: "vericompute:wallet-session:v1",
        userId: user.id,
        wallet: address,
        expiresAt: Math.floor(Date.now() / 1000) + 600,
      };
      const canonical = JSON.stringify(payload, Object.keys(payload).sort());
      const signed = await solana.signMessage(
        new TextEncoder().encode(canonical),
        "utf8",
      );
      const sig = btoa(
        String.fromCharCode(...new Uint8Array(signed.signature)),
      );
      sessionStorage.setItem(
        "vc-wallet-proof",
        btoa(JSON.stringify({ payload, signature: sig })),
      );
      setWallet(address);
      setNotice("Wallet ownership confirmed for 10 minutes.");
    } catch (e) {
      setNotice((e as Error).message);
    }
  }
  const filtered = useMemo(
    () =>
      offers
        .filter(
          (o) =>
            (gpu === "All GPUs" || o.gpuModel === gpu) &&
            (vram === "Any VRAM" || o.vramMb >= Number(vram) * 1024) &&
            (!available ||
              (o.available && Date.now() / 1000 - o.heartbeatAt < 90)) &&
            `${o.gpuModel} ${o.region} ${o.provider}`
              .toLowerCase()
              .includes(query.toLowerCase()),
        )
        .sort((a, b) =>
          sort === "Highest reputation"
            ? b.reputation - a.reputation
            : Number(a.rateBaseUnitsPerSecond) -
              Number(b.rateBaseUnitsPerSecond),
        ),
    [offers, gpu, vram, available, query, sort],
  );
  const models = [...new Set(offers.map((o) => o.gpuModel))];
  return (
    <div className="app">
      <header className="header">
        <Link href="/" className="brand">
          <span className="brand-mark">
            <i />
            <i />
            <i />
          </span>
          vericompute<span className="beta">BETA</span>
        </Link>
        <nav className={menu ? "nav open" : "nav"}>
          {nav.map(([label, href]) => (
            <Link
              key={href}
              className={
                path.startsWith(href) || (href === "/market" && path === "/")
                  ? "active"
                  : ""
              }
              href={href}
              onClick={() => setMenu(false)}
            >
              {label}
            </Link>
          ))}
        </nav>
        <div className="header-actions">
          <Link href="/docs" className="docs-link">
            Docs <ArrowUpRight size={13} />
          </Link>
          <button className="wallet-button" onClick={connect}>
            <Wallet size={15} />
            {wallet ? short(wallet) : user ? "Connect wallet" : "Sign in"}
          </button>
          <button
            className="mobile-menu icon-button"
            aria-label="Toggle navigation"
            onClick={() => setMenu(!menu)}
          >
            <Menu size={20} />
          </button>
        </div>
      </header>
      <div className="network-strip">
        <span>
          <i
            className={
              stats?.lastIndexedSlot ? "status-dot" : "status-dot neutral"
            }
          />
          {stats?.network ?? "CONNECTING"} <span className="muted">/</span>{" "}
          <span className="muted">
            {stats?.lastIndexedSlot
              ? `Indexed slot ${Number(stats.lastIndexedSlot).toLocaleString()}`
              : "Awaiting chain indexer"}
          </span>
        </span>
        <span className="strip-right">
          Settlement currency <b>{stats?.settlementAsset ?? "TEST USDC"}</b>
          <span className="solana-mark">≋</span> on Solana
        </span>
      </div>
      {stats?.mode === "read-only-preview" && (
        <div className="preview-banner" role="status">
          <ShieldCheck size={15} />
          <span>
            Public preview: inventory is development data. Transactions stay
            disabled until the devnet program and settlement mint are live.
          </span>
        </div>
      )}
      <main>
        {market ? (
          <>
            <section className="hero">
              <div>
                <div className="eyebrow">
                  <span /> THE OPEN COMPUTE EXCHANGE
                </div>
                <h1>
                  Compute.
                  <br />
                  <span>On your terms.</span>
                </h1>
                <p>
                  Find your compute. Set your price. Own the outcome.
                  <br />
                  An open market for GPU power, settled on Solana.
                </p>
                <div className="hero-actions">
                  <Link href="/jobs/new" className="button primary">
                    Create compute intent <ArrowUpRight size={17} />
                  </Link>
                  <Link href="/host" className="text-link">
                    Provide compute <ArrowRight size={16} />
                  </Link>
                </div>
                <div className="hero-tags">
                  <span>
                    <ShieldCheck size={14} /> Execution evidence
                  </span>
                  <span>
                    <Command size={14} /> Agent native
                  </span>
                  <span>
                    <Box size={14} /> No platform token
                  </span>
                </div>
              </div>
              <div
                className="compute-art"
                aria-label="Compute demand routes to independently operated GPU providers"
              >
                <div className="art-orbit orbit-one" />
                <div className="art-orbit orbit-two" />
                <div className="art-orbit orbit-three" />
                <div className="art-line line-one" />
                <div className="art-line line-two" />
                <div className="art-label label-top">
                  DEMAND → EXECUTION → EVIDENCE
                </div>
                <div className="compute-core">
                  <div className="core-top">
                    <Cpu size={35} />
                    <span>VC / 01</span>
                  </div>
                  <div className="core-grid">
                    {Array.from({ length: 36 }, (_, i) => (
                      <i key={i} />
                    ))}
                  </div>
                  <div className="core-bottom">
                    <i /> COMPUTE ENGINE <span>↗</span>
                  </div>
                </div>
                <div className="float-chip chip-one">
                  <i /> USDC <span>SETTLEMENT</span>
                </div>
                <div className="float-chip chip-two">
                  <ShieldCheck size={15} /> SIGNED RECEIPTS
                </div>
                <div className="art-coordinate">
                  OPEN INFRASTRUCTURE
                  <br />
                  <span>PROGRAMMABLE BY DESIGN</span>
                </div>
              </div>
            </section>
            <section className="stat-bar">
              <Metric
                label="Registered machines"
                value={stats?.machines ?? "—"}
                detail={
                  stats?.mode === "read-only-preview"
                    ? "Development projection"
                    : "On-chain registry"
                }
                icon={<Cpu size={17} />}
              />
              <Metric
                label="Registered providers"
                value={stats?.providers ?? "—"}
                detail={
                  stats?.mode === "read-only-preview"
                    ? "Development projection"
                    : "Permissionless supply"
                }
                icon={<Globe size={17} />}
              />
              <Metric
                label="Compute intents"
                value={stats?.jobs ?? "—"}
                detail={
                  stats?.mode === "read-only-preview"
                    ? "Development projection"
                    : "Indexed from Solana"
                }
                icon={<Activity size={17} />}
              />
              <Metric
                label="Protocol fee"
                value="2%"
                detail={
                  stats?.mode === "read-only-preview"
                    ? "Preview configuration"
                    : "Protocol configuration"
                }
                icon={<ShieldCheck size={17} />}
              />
            </section>
            <section className="market-section">
              <div className="section-heading">
                <div>
                  <div className="eyebrow subtle">
                    DISCOVER YOUR NEXT MACHINE
                  </div>
                  <h2>
                    The compute market <span>{offers.length}</span>
                  </h2>
                </div>
                <div className="view-switch">
                  <button
                    aria-label="List view"
                    className={view === "list" ? "selected" : ""}
                    onClick={() => setView("list")}
                  >
                    <List size={17} />
                  </button>
                  <button
                    aria-label="Grid view"
                    className={view === "grid" ? "selected" : ""}
                    onClick={() => setView("grid")}
                  >
                    <LayoutGrid size={16} />
                  </button>
                </div>
              </div>
              <div className="market-toolbar">
                <div className="filter-group">
                  <Select
                    label="GPU model"
                    value={gpu}
                    onChange={setGpu}
                    options={["All GPUs", ...models]}
                  />
                  <Select
                    label="Minimum VRAM"
                    value={vram}
                    onChange={setVram}
                    options={["Any VRAM", "24", "48", "80"]}
                  />
                  <label className="availability">
                    <input
                      type="checkbox"
                      checked={available}
                      onChange={(e) => setAvailable(e.target.checked)}
                    />
                    <span /> Available now
                  </label>
                </div>
                <div className="search">
                  <Search size={16} />
                  <input
                    aria-label="Search market"
                    placeholder="Search GPUs, regions…"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                  <kbd>⌕</kbd>
                </div>
              </div>
              <div className="table-meta">
                <span>
                  {filtered.length} offers <i /> Prices in{" "}
                  {stats?.settlementAsset ?? "TEST USDC"} per hour
                </span>
                <div>
                  <button
                    className="icon-button"
                    aria-label="Refresh market"
                    onClick={refresh}
                  >
                    <RefreshCw size={13} />
                  </button>
                  <span>Sort by</span>
                  <Select
                    label="Sort offers"
                    value={sort}
                    onChange={setSort}
                    options={["Lowest price", "Highest reputation"]}
                  />
                </div>
              </div>
              {error ? (
                <ErrorState message={error} retry={refresh} />
              ) : loading ? (
                <div className="loading-state">Loading on-chain supply…</div>
              ) : filtered.length ? (
                <div className={view === "grid" ? "offer-grid" : "offer-table"}>
                  {view === "list" && (
                    <div className="table-head">
                      <span>GPU / HARDWARE</span>
                      <span>PROVIDER</span>
                      <span>REGION</span>
                      <span>AVAILABILITY</span>
                      <span>PRICE / HR</span>
                      <span />
                    </div>
                  )}
                  {filtered.map((o) => (
                    <OfferRow
                      key={o.id}
                      offer={o}
                      preview={stats?.mode === "read-only-preview"}
                    />
                  ))}
                </div>
              ) : (
                <div className="empty-market">
                  <Cpu size={32} />
                  <h3>
                    {offers.length
                      ? "No offers match your filters"
                      : "The market is ready for its first provider"}
                  </h3>
                  <p>
                    {offers.length
                      ? "Adjust your GPU and memory filters to see more supply."
                      : "Registered machines and signed offers will appear here once indexed."}
                  </p>
                  <Link href="/host/setup" className="button secondary">
                    Set up a provider <ArrowUpRight size={15} />
                  </Link>
                </div>
              )}
              {nextOfferCursor && !loading && (
                <div className="form-buttons">
                  <button className="button secondary" onClick={loadMoreOffers}>
                    Load more offers <ArrowDown size={15} />
                  </button>
                </div>
              )}
              <div className="market-footnote">
                <ShieldCheck size={14} />
                <span>
                  Hardware is provider-claimed unless benchmark evidence is
                  available. Signed receipts are not a proof of computation.
                </span>
                <Link href="/docs">
                  Understand verification <ArrowUpRight size={13} />
                </Link>
              </div>
            </section>
            <section className="agent-banner">
              <div className="agent-icon">
                <Terminal size={24} />
              </div>
              <div>
                <h3>Built for the next wave of builders.</h3>
                <p>
                  Your agent can find compute, compare quotes, and submit an
                  intent.
                </p>
              </div>
              <Link href="/docs" className="text-link">
                Explore the SDK <ArrowUpRight size={17} />
              </Link>
            </section>
          </>
        ) : path === "/jobs/new" ? (
          <NewJob notify={setNotice} signedIn={!!user} signIn={connect} />
        ) : path === "/jobs" ? (
          <Jobs connected={!!wallet} connect={connect} />
        ) : path === "/agents" ? (
          <AgentPolicies
            connected={!!wallet}
            connect={connect}
            notify={setNotice}
          />
        ) : path.startsWith("/jobs/") ? (
          <JobDetail
            id={path.split("/")[2]!}
            connected={!!wallet}
            connect={connect}
          />
        ) : path.startsWith("/host") || path === "/dashboard/provider" ? (
          <Host setup={path.includes("setup")} notify={setNotice} />
        ) : path === "/providers" ||
          path.startsWith("/providers/") ||
          path.startsWith("/machines/") ? (
          <Providers offers={offers} stats={stats} />
        ) : path === "/network" ||
          path === "/prices" ||
          path === "/explorer" ? (
          <Network stats={stats} offers={offers} />
        ) : (
          <Docs />
        )}
      </main>
      <footer>
        <Link href="/" className="footer-brand">
          <span className="brand-mark small">
            <i />
            <i />
            <i />
          </span>
          vericompute
        </Link>
        <span>Compute as a market.</span>
        <div>
          <Link href="/docs">Documentation</Link>
          <Link href="/network">Network status</Link>
          <span className="footer-network">
            <i className="status-dot" />
            {stats?.network ?? "Development"}
          </span>
          {user && (
            <button
              className="icon-button"
              aria-label="Sign out"
              onClick={async () => {
                await logout();
                setUser(null);
                setWallet("");
                sessionStorage.removeItem("vc-wallet-proof");
              }}
            >
              <LogOut size={14} />
            </button>
          )}
        </div>
      </footer>
      {notice && (
        <div className="toast" role="status">
          {notice}
          <button
            className="icon-button"
            aria-label="Dismiss notification"
            onClick={() => setNotice("")}
          >
            <X size={16} />
          </button>
        </div>
      )}
      {modal && (
        <AuthModal
          close={() => setModal(false)}
          done={async () => {
            setModal(false);
            const { data } = await getBackend().auth.getCurrentUser();
            setUser(data?.user);
            setNotice("Signed in. Connect your wallet to view on-chain jobs.");
          }}
        />
      )}
    </div>
  );
}
function Metric({
  label,
  value,
  detail,
  icon,
}: {
  label: string;
  value: string | number;
  detail: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="metric">
      <div>
        {label}
        {icon}
      </div>
      <strong>
        {typeof value === "number" ? value.toLocaleString() : value}
      </strong>
      <small>{detail}</small>
    </div>
  );
}
function Select({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (s: string) => void;
  options: string[];
}) {
  return (
    <div className="select-wrap">
      <select
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((o) => (
          <option key={o}>{o}</option>
        ))}
      </select>
      <ChevronDown size={12} />
    </div>
  );
}
function OfferRow({ offer: o, preview }: { offer: Offer; preview: boolean }) {
  const online = o.available && Date.now() / 1000 - o.heartbeatAt < 90;
  return (
    <div className="offer-row">
      <div className="hardware">
        <div className="gpu-icon">
          <Cpu size={23} />
        </div>
        <div>
          <h3>{o.gpuModel}</h3>
          <span>
            {o.gpuCount}× GPU <i /> {Math.round(o.vramMb / 1024)} GB VRAM
          </span>
        </div>
      </div>
      <div className="provider-cell">
        <Link href={`/providers/${o.provider}`}>
          {short(o.provider)} <ArrowUpRight size={11} />
        </Link>
        <small>
          <ShieldCheck size={11} />{" "}
          {o.reputation ? `${o.reputation}% job success` : "New provider"}
        </small>
      </div>
      <div className="region-cell">
        <Globe size={13} />
        {o.region}
      </div>
      <div>
        <span className={online ? "online-pill" : "offline-pill"}>
          <i />
          {online ? "Available now" : "Offline"}
        </span>
        <small className="trust-label">
          {o.trustLevel === "BENCHMARKED"
            ? "Standard benchmark passed"
            : "Provider-claimed hardware"}
        </small>
      </div>
      <div className="price">
        {dollars((Number(o.rateBaseUnitsPerSecond) * 3600) / 1e6)}
        <small>/ hour</small>
      </div>
      {preview ? (
        <span className="rent-button disabled" aria-label="Preview only">
          Preview
        </span>
      ) : (
        <Link href={`/jobs/new?offer=${o.id}`} className="rent-button">
          Select <ArrowUpRight size={13} />
        </Link>
      )}
    </div>
  );
}
function PageHeading({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <div className="page-heading">
      <div className="eyebrow">{eyebrow}</div>
      <h1>{title}</h1>
      <p>{description}</p>
    </div>
  );
}
function ErrorState({
  message,
  retry,
}: {
  message: string;
  retry?: () => void;
}) {
  return (
    <div className="error-state" role="alert">
      <p>{message}</p>
      {retry && (
        <button className="button secondary" onClick={retry}>
          Try again
        </button>
      )}
    </div>
  );
}
function NewJob({
  notify,
  signedIn,
  signIn,
}: {
  notify: (s: string) => void;
  signedIn: boolean;
  signIn: () => void;
}) {
  const router = useRouter(),
    params = useSearchParams();
  const [name, setName] = useState("My compute job"),
    [repository, setRepository] = useState(""),
    [digest, setDigest] = useState(""),
    [command, setCommand] = useState("python main.py"),
    [gpu, setGpu] = useState("Any NVIDIA GPU"),
    [vram, setVram] = useState("24"),
    [duration, setDuration] = useState("300"),
    [budget, setBudget] = useState("0.10"),
    [policy, setPolicy] = useState("STANDARD"),
    [quotes, setQuotes] = useState<any[] | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    const offerId = params.get("offer");
    if (offerId)
      void api("/v1/offers")
        .then(({ offers }) => {
          const o = offers.find((o: Offer) => o.id === offerId);
          if (o) {
            setGpu(o.gpuCount === 0 ? "CPU only" : o.gpuModel);
            setVram(String(o.vramMb / 1024));
          }
        })
        .catch((e) => setError(e.message));
  }, [params]);
  const spec = () => ({
    version: "1",
    runtime: "oci",
    image: {
      repository,
      digest: digest.startsWith("sha256:") ? digest : `sha256:${digest}`,
    },
    command: command.trim().split(/\s+/),
    resources: {
      gpu: {
        count: gpu === "CPU only" ? 0 : 1,
        minimumVramMb: gpu === "CPU only" ? 0 : Number(vram) * 1024,
        allowedModels: ["Any NVIDIA GPU", "CPU only"].includes(gpu)
          ? []
          : [gpu],
      },
      cpuCores: gpu === "CPU only" ? 1 : 4,
      ramMb: gpu === "CPU only" ? 256 : 16384,
      storageMb: 1024,
    },
    execution: { timeoutSeconds: Number(duration), maxStartDelaySeconds: 60 },
    network: { mode: "deny-by-default", allow: [] },
    verification: { policy },
    inputs: [],
  });
  async function execute(action: "quote" | "save" | "submit") {
    setError("");
    if (action !== "quote" && !signedIn) {
      signIn();
      return;
    }
    setBusy(true);
    try {
      if (action === "quote") {
        const r = await api("/v1/quotes", {
          spec: spec(),
          maxSpendBaseUnits: String(Math.round(Number(budget) * 1e6)),
        });
        setQuotes(r.quotes);
      } else if (action === "submit") {
        if (!sessionStorage.getItem("vc-wallet-proof")) {
          signIn();
          return;
        }
        const built = await api("/v1/jobs", {
          spec: spec(),
          maxSpendBaseUnits: String(Math.round(Number(budget) * 1e6)),
        });
        await signTransaction(built);
        router.push(`/jobs/${built.jobId}`);
        notify(
          `Job funded on Solana · ${short(built.jobId)}. Providers can now bid.`,
        );
      } else {
        const r = await api("/v1/specs", { name, spec: spec() });
        notify(
          `Intent saved · ${short(r.hash)}. Use the SDK to sign and fund it on Solana.`,
        );
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <PageHeading
        eyebrow="PROGRAMMABLE PROCUREMENT"
        title="Make your compute intent."
        description="Define your workload and budget. Let providers compete for your job."
      />
      <div className="form-layout">
        <div className="panel">
          <div className="panel-title">
            <Box size={18} />
            <h2>Workload specification</h2>
            <span>OCI CONTAINER</span>
          </div>
          <div className="form-fields">
            <label>
              Job name
              <input value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <label>
              Container repository
              <input
                placeholder="ghcr.io/your-team/inference"
                value={repository}
                onChange={(e) => setRepository(e.target.value)}
              />
            </label>
            <label>
              Immutable image digest
              <input
                placeholder="sha256:… (64 hex characters)"
                value={digest}
                onChange={(e) => setDigest(e.target.value)}
              />
              <small>
                Mutable tags are not accepted. This digest is committed with
                your job.
              </small>
            </label>
            <label>
              Command
              <input
                value={command}
                onChange={(e) => setCommand(e.target.value)}
              />
            </label>
            <div className="form-pair">
              <label>
                GPU class
                <Select
                  label="GPU class"
                  value={gpu}
                  onChange={setGpu}
                  options={[
                    "Any NVIDIA GPU",
                    "CPU only",
                    "RTX4090",
                    "A100",
                    "H100",
                    ...(![
                      "Any NVIDIA GPU",
                      "CPU only",
                      "RTX4090",
                      "A100",
                      "H100",
                    ].includes(gpu)
                      ? [gpu]
                      : []),
                  ]}
                />
              </label>
              <label>
                Minimum VRAM (GB)
                <input
                  type="number"
                  min="1"
                  value={vram}
                  onChange={(e) => setVram(e.target.value)}
                />
              </label>
            </div>
            <div className="form-pair">
              <label>
                Maximum runtime (seconds)
                <input
                  type="number"
                  min="1"
                  max="86400"
                  value={duration}
                  onChange={(e) => setDuration(e.target.value)}
                />
              </label>
              <label>
                Total budget (USDC)
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={budget}
                  onChange={(e) => setBudget(e.target.value)}
                />
              </label>
            </div>
            <label>
              Verification policy
              <Select
                label="Verification policy"
                value={policy}
                onChange={setPolicy}
                options={["STANDARD", "BASIC"]}
              />
            </label>
            <div className="inline-note">
              <ShieldCheck size={16} /> Network access is denied. Containers run
              without root privileges.
            </div>
            {error && <ErrorState message={error} />}
            <div className="form-buttons">
              <button
                disabled={busy}
                className="button primary"
                onClick={() => execute("quote")}
              >
                {busy ? "Checking…" : "Find matching quotes"}
                <ArrowRight size={16} />
              </button>
              <button
                disabled={busy}
                className="button secondary"
                onClick={() => execute("save")}
              >
                Save intent
              </button>
              <button
                disabled={busy}
                className="button secondary"
                onClick={() => execute("submit")}
              >
                Sign & fund
              </button>
            </div>
          </div>
        </div>
        <aside>
          <div className="summary-card">
            <div className="eyebrow">YOUR COMPUTE BUDGET</div>
            <strong>
              {dollars(Number(budget))}
              <span>USDC</span>
            </strong>
            <p>
              Escrowed on Solana when you sign and fund the job. Unused budget
              returns to your wallet.
            </p>
            <hr />
            <div>
              <span>Runtime ceiling</span>
              <b>{Number(duration) / 60} minutes</b>
            </div>
            <div>
              <span>Assurance</span>
              <b>{policy === "STANDARD" ? "VERIFY_1" : "VERIFY_0"}</b>
            </div>
            <div>
              <span>Network access</span>
              <b>Denied</b>
            </div>
          </div>
          <div className="panel quote-panel">
            <h3>Provider quotes</h3>
            {quotes === null ? (
              <p>Enter a pinned workload to compare compatible supply.</p>
            ) : quotes.length ? (
              quotes.map((q) => (
                <div key={q.supply.id} className="quote-row">
                  <span>
                    {q.supply.gpuModel}
                    <small>{short(q.supply.provider)}</small>
                  </span>
                  <b>{dollars(Number(q.totalBaseUnits) / 1e6)}</b>
                </div>
              ))
            ) : (
              <p>
                No live provider currently matches this intent. Save it or
                adjust the requirements.
              </p>
            )}
          </div>
        </aside>
      </div>
    </>
  );
}
function Jobs({
  connected,
  connect,
}: {
  connected: boolean;
  connect: () => void;
}) {
  const [jobs, setJobs] = useState<any[]>([]),
    [error, setError] = useState("");
  useEffect(() => {
    if (connected)
      api("/v1/jobs")
        .then((r) => setJobs(r.jobs))
        .catch((e) => setError(e.message));
  }, [connected]);
  return (
    <>
      <PageHeading
        eyebrow="YOUR WORKLOADS"
        title="Every job. Every outcome."
        description="Follow your compute from intent to execution evidence and settlement."
      />
      <div className="section-heading">
        <h2>
          My jobs <span>{jobs.length}</span>
        </h2>
        <Link href="/jobs/new" className="button primary">
          <Plus size={16} />
          New intent
        </Link>
      </div>
      {!connected ? (
        <div className="empty-market">
          <Wallet size={30} />
          <h3>Connect your buyer wallet</h3>
          <p>Sign in and prove wallet ownership to access your job records.</p>
          <button className="button primary" onClick={connect}>
            Connect wallet
          </button>
        </div>
      ) : error ? (
        <ErrorState message={error} />
      ) : !jobs.length ? (
        <div className="empty-market">
          <Box size={30} />
          <h3>Your first job starts with an intent</h3>
          <p>Choose your workload, hardware, and maximum spend.</p>
          <Link href="/jobs/new" className="button primary">
            Create an intent <ArrowUpRight size={15} />
          </Link>
        </div>
      ) : (
        <div className="panel">
          {jobs.map((j) => (
            <Link href={`/jobs/${j.id}`} className="job-row" key={j.id}>
              <Box size={20} />
              <span>
                {short(j.id)}
                <small>{j.verification_policy}</small>
              </span>
              <span className="online-pill">{j.state}</span>
              <b>{dollars(Number(j.budget) / 1e6)}</b>
              <ArrowUpRight size={15} />
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
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
function JobDetail({
  id,
  connected,
  connect,
}: {
  id: string;
  connected: boolean;
  connect: () => void;
}) {
  const [job, setJob] = useState<any>(null),
    [bids, setBids] = useState<any[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [evidence, setEvidence] = useState("");
  useEffect(() => {
    if (!connected) return;
    let live = true;
    const refresh = async () => {
      try {
        const [j, b] = await Promise.all([
          api(`/v1/jobs/${id}`),
          api(`/v1/jobs/${id}/bids`),
        ]);
        if (live) {
          setJob(j.job);
          setBids(b.bids);
        }
      } catch (e) {
        if (live) setError((e as Error).message);
      }
    };
    void refresh();
    const timer = setInterval(refresh, 5000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [connected, id]);
  async function act(action: string, body: unknown = {}) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const signature = await signTransaction(
        await api(`/v1/jobs/${id}/${action}`, body),
      );
      setMessage(
        `Confirmed · ${short(signature)}. Finalized state will appear shortly.`,
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function inspect(field: string) {
    setBusy(true);
    setError("");
    try {
      const data = await api(`/v1/jobs/${id}/${field}`);
      if (data.status === "pending")
        setEvidence("Execution evidence is pending.");
      else if (field === "logs")
        setEvidence(
          [
            "STDOUT",
            Buffer.from(data.stdout, "base64").toString("utf8"),
            "STDERR",
            Buffer.from(data.stderr, "base64").toString("utf8"),
          ].join("\n"),
        );
      else if (field === "result")
        setEvidence(Buffer.from(data.result, "base64").toString("utf8"));
      else setEvidence(JSON.stringify(data, null, 2));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <PageHeading
        eyebrow="EXECUTION RECORD"
        title={short(id)}
        description="Follow bids, execution evidence, and settlement. Each action requests your wallet signature."
      />
      {!connected ? (
        <button className="button primary" onClick={connect}>
          Connect buyer wallet
        </button>
      ) : (
        <>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          {message && <p role="status">{message}</p>}
          {job ? (
            <>
              <div className="job-actions">
                {["CREATED", "OPEN"].includes(job.state) && (
                  <button
                    disabled={busy}
                    className="button secondary"
                    onClick={() => act("cancel")}
                  >
                    Cancel job
                  </button>
                )}
                {["OPEN", "ASSIGNED", "RUNNING", "VERIFYING"].includes(
                  job.state,
                ) && (
                  <button
                    disabled={busy}
                    className="button secondary"
                    onClick={() => act("expire")}
                  >
                    Claim timeout
                  </button>
                )}
                {job.state === "COMPLETED" && !job.settled && (
                  <button
                    disabled={busy}
                    className="button primary"
                    onClick={() => act("settle")}
                  >
                    Settle payment
                  </button>
                )}
                {["CANCELLED", "EXPIRED", "FAILED"].includes(job.state) &&
                  !job.settled && (
                    <button
                      disabled={busy}
                      className="button primary"
                      onClick={() => act("refund")}
                    >
                      Refund escrow
                    </button>
                  )}
                {["logs", "result", "receipt", "verifications", "events"].map(
                  (field) => (
                    <button
                      key={field}
                      disabled={busy}
                      className="button secondary"
                      onClick={() => inspect(field)}
                    >
                      View {field}
                    </button>
                  ),
                )}
              </div>
              {job.state === "OPEN" && (
                <section className="panel detail-panel">
                  <h2>Provider bids</h2>
                  {!bids.length && (
                    <p>
                      Waiting for a provider to bid. This page refreshes every
                      five seconds.
                    </p>
                  )}
                  {bids.map((b) => (
                    <div key={b.id}>
                      <span>
                        {short(b.provider_id)} ·{" "}
                        {dollars(Number(b.price) / 1e6)}
                      </span>
                      <button
                        disabled={
                          busy || Number(b.expires_at) <= Date.now() / 1000
                        }
                        className="button primary"
                        onClick={() => act("accept-bid", { bidId: b.id })}
                      >
                        Accept bid
                      </button>
                    </div>
                  ))}
                </section>
              )}
              <div className="panel detail-panel">
                {Object.entries(job).map(([k, v]) => (
                  <div key={k}>
                    <span>{k.replaceAll("_", " ")}</span>
                    <code>{String(v)}</code>
                  </div>
                ))}
              </div>
              {evidence && (
                <section className="panel detail-panel">
                  <h2>Execution evidence</h2>
                  <pre className="evidence-output">{evidence}</pre>
                </section>
              )}
            </>
          ) : (
            !error && <p>Loading job…</p>
          )}
        </>
      )}
    </>
  );
}
function Host({
  setup,
  notify,
}: {
  setup: boolean;
  notify: (s: string) => void;
}) {
  const command =
    "npx tsx --env-file=.env.local agents/provider-node/cli.ts status";
  return (
    <>
      <PageHeading
        eyebrow="SUPPLY THE NETWORK"
        title={
          setup
            ? "Bring your machine online."
            : "Your hardware. An open market."
        }
        description="Publish your capacity, set your price, and earn USDC for completed, verified workloads."
      />
      <div className="host-layout">
        <div className="panel host-panel">
          <Server size={34} />
          <h2>Become a compute provider</h2>
          <p>
            Your provider wallet controls revenue and worker delegation. A
            separate worker key runs on the compute host.
          </p>
          <div className="setup-step">
            <span>1</span>
            <div>
              <h3>Prepare your host</h3>
              <p>
                Linux, NVIDIA drivers, Container Toolkit, Docker, and a
                supported GPU. Run hardware detection before registering claims.
              </p>
            </div>
          </div>
          <div className="setup-step">
            <span>2</span>
            <div>
              <h3>Register and delegate</h3>
              <p>
                Register your provider and machine on Solana, then authorize a
                limited worker key. Keep the authority wallet off the host.
              </p>
            </div>
          </div>
          <div className="setup-step">
            <span>3</span>
            <div>
              <h3>Publish capacity</h3>
              <p>
                Create an offer with an explicit price and expiry. Signed
                heartbeats tell buyers when your machine is available.
              </p>
            </div>
          </div>
          <Link className="button primary" href="/docs">
            Read the provider guide <ArrowUpRight size={15} />
          </Link>
        </div>
        <aside>
          <div className="terminal-card">
            <div>
              <i />
              <i />
              <i />
              <span>PROVIDER CLI</span>
            </div>
            <pre>{`$ compute-node detect\n\nGPU model       from nvidia-smi\nHardware trust  CLAIMED\nWorker key      delegated\nNetwork         deny by default\n\n# Check your configured node\n${command}`}</pre>
            <button
              className="copy-button"
              onClick={async () => {
                await navigator.clipboard.writeText(command);
                notify("Provider command copied");
              }}
            >
              <Copy size={14} /> Copy status command
            </button>
          </div>
          <div className="inline-note">
            Real GPU execution requires a configured Linux GPU host. This
            development environment has no Docker runtime.
          </div>
        </aside>
      </div>
    </>
  );
}
function Providers({ offers, stats }: { offers: Offer[]; stats: any }) {
  const providers = [...new Set(offers.map((o) => o.provider))];
  return (
    <>
      <PageHeading
        eyebrow="INDEPENDENT INFRASTRUCTURE"
        title="Meet the supply side."
        description="Provider and machine reputation remain separate. New hardware starts with its own history."
      />
      <div className="section-heading">
        <h2>
          Network providers <span>{stats?.providers ?? 0}</span>
        </h2>
        <Link href="/host" className="button primary">
          Become a provider <ArrowUpRight size={16} />
        </Link>
      </div>
      <div className="provider-grid">
        {providers.length ? (
          providers.map((p) => (
            <div className="panel provider-card" key={p}>
              <div className="provider-avatar">
                <Server size={24} />
              </div>
              <h3>{short(p)}</h3>
              <p>Independent compute provider</p>
              <div>
                {offers
                  .filter((o) => o.provider === p)
                  .map((o) => (
                    <div className="provider-machine" key={o.id}>
                      <Cpu size={15} />
                      {o.gpuModel}
                      <b>{Math.round(o.vramMb / 1024)} GB</b>
                    </div>
                  ))}
              </div>
              <span className="claimed-label">CLAIMED HARDWARE</span>
            </div>
          ))
        ) : (
          <div className="empty-market">
            <Server size={30} />
            <h3>No providers indexed yet</h3>
            <p>Complete on-chain registration to join the network.</p>
          </div>
        )}
      </div>
    </>
  );
}
function Network({ stats, offers }: { stats: any; offers: Offer[] }) {
  return (
    <>
      <PageHeading
        eyebrow="TRANSPARENT BY DESIGN"
        title="The network, in view."
        description={
          stats?.mode === "read-only-preview"
            ? "Development projections from the local protocol test ledger. Public transactions remain disabled."
            : "Live registry projections. Every count comes from indexed protocol accounts."
        }
      />
      <section className="stat-bar">
        <Metric
          label="Providers"
          value={stats?.providers ?? "—"}
          detail="Registered authorities"
          icon={<Server size={17} />}
        />
        <Metric
          label="Machines"
          value={stats?.machines ?? "—"}
          detail="Distinct hardware records"
          icon={<Cpu size={17} />}
        />
        <Metric
          label="Jobs"
          value={stats?.jobs ?? "—"}
          detail="Compute intents"
          icon={<Box size={17} />}
        />
        <Metric
          label="Last indexed slot"
          value={stats?.lastIndexedSlot ?? "—"}
          detail={
            stats?.mode === "read-only-preview"
              ? "Development ledger"
              : "Finalized commitment"
          }
          icon={<Activity size={17} />}
        />
      </section>
      <div className="panel network-panel">
        <Globe size={36} />
        <h2>
          {stats?.lastIndexedSlot
            ? "Indexer is reporting"
            : "Waiting for the indexer"}
        </h2>
        <p>
          {stats?.lastIndexedAt
            ? `Latest reconciliation: ${new Date(stats.lastIndexedAt).toLocaleString()}`
            : "Start the local validator, deploy the protocol, and run the indexer."}
        </p>
        <div className="network-stages">
          <span>Live subscription</span>
          <ArrowRight size={15} />
          <span>History recovery</span>
          <ArrowRight size={15} />
          <span>State reconciliation</span>
        </div>
        <p className="muted">
          {offers.length} published offers ·{" "}
          {stats?.network ?? "development network"}
        </p>
      </div>
    </>
  );
}
function Docs() {
  return (
    <>
      <PageHeading
        eyebrow="DEVELOPER RESOURCES"
        title="Compute is a primitive."
        description="Integrate procurement into your application, worker, or autonomous agent."
      />
      <div className="docs-layout">
        <aside className="docs-sidebar">
          <a href="#quickstart">Quickstart</a>
          <a href="#trust">Verification model</a>
          <a href="#settlement">Settlement</a>
          <a href="#provider">Provider security</a>
        </aside>
        <article className="docs-content">
          <h2 id="quickstart">Start with a compute intent</h2>
          <p>
            A digest-pinned OCI workload, bounded resources, maximum spend, and
            an explicit verification policy define the job. The SDK constructs
            transactions for your wallet to sign.
          </p>
          <pre>{`import { ComputeClient } from '@vericompute/sdk';\n\nconst compute = new ComputeClient({\n  apiUrl: 'http://localhost:4000',\n  accessToken, walletProof\n});\n\nconst quotes = await compute.quote({\n  spec,\n  maxSpendBaseUnits: '100000' // 0.10 USDC\n});\n\n// Sign and send returned instructions using your wallet.\nconst intent = await compute.createJob({\n  spec, maxSpendBaseUnits: '100000'\n});`}</pre>
          <h2 id="trust">Evidence has an explicit trust level</h2>
          <p>
            BASIC establishes a signed worker claim. STANDARD also checks
            assignment, image, inputs, outputs, hardware commitments, and
            timing. Neither proves computation or provides confidentiality.
            Challenge, redundancy, TEE, and proof policies are not enabled.
          </p>
          <h2 id="settlement">Escrow belongs to the Solana program</h2>
          <p>
            The buyer deposits an approved SPL token into a per-job vault. After
            verification and the dispute period, settlement atomically pays the
            provider, protocol fee, and unused budget refund. InsForge stores
            projections and private evidence; it never holds buyer funds.
          </p>
          <h2 id="provider">Separate authority from execution</h2>
          <p>
            Provider wallets authorize and revoke worker keys. Containers have
            no host mounts, no host network, no root access, resource limits,
            and bounded runtime. Hardware claims remain labeled as claims until
            supporting benchmark evidence exists.
          </p>
          <div className="inline-note">
            Development release: the SDK and protocol are not published or
            audited for mainnet use. Consult the repository README for tested
            capabilities and outstanding work.
          </div>
        </article>
      </div>
    </>
  );
}
function AuthModal({ close, done }: { close: () => void; done: () => void }) {
  const [mode, setMode] = useState<"signin" | "signup" | "verify">("signin"),
    [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
      if (event.key !== "Tab") return;
      const items = [
        ...(dialog.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), [tabindex="0"]',
        ) ?? []),
      ];
      const first = items[0],
        last = items.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      }
      if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
      previous?.focus();
    };
  }, [close]);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const r = await authenticate(mode, email, password);
      if (r.error) setError(r.error);
      else if (r.verification) {
        setMode("verify");
        setPassword("");
      } else done();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="modal-backdrop" onClick={close}>
      <div
        className="auth-modal"
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="auth-title"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          className="modal-close icon-button"
          onClick={close}
          aria-label="Close sign in"
        >
          <X size={20} />
        </button>
        <div className="auth-icon">
          <Command size={27} />
        </div>
        <h2 id="auth-title">
          {mode === "signin"
            ? "Welcome to the exchange."
            : mode === "signup"
              ? "Build on open compute."
              : "Check your email."}
        </h2>
        <p>
          {mode === "verify"
            ? "Enter the verification code sent to your email."
            : "Sign in to save intents and manage your compute."}
        </p>
        <form onSubmit={submit}>
          <label>
            Email
            <input
              autoFocus
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <label>
            {mode === "verify" ? "Verification code" : "Password"}
            <input
              type={mode === "verify" ? "text" : "password"}
              autoComplete={
                mode === "signin" ? "current-password" : "new-password"
              }
              required
              minLength={mode === "verify" ? 6 : 8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <button className="button primary" disabled={busy}>
            {busy
              ? "Please wait…"
              : mode === "signin"
                ? "Sign in"
                : mode === "signup"
                  ? "Create account"
                  : "Verify email"}
            <ArrowRight size={16} />
          </button>
        </form>
        {mode !== "verify" && (
          <button
            className="auth-switch"
            onClick={() => {
              setMode(mode === "signin" ? "signup" : "signin");
              setError("");
            }}
          >
            {mode === "signin"
              ? "New here? Create an account"
              : "Already have an account? Sign in"}
          </button>
        )}
      </div>
    </div>
  );
}
