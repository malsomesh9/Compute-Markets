# Vericompute

An InsForge-backed compute exchange with an Anchor Solana escrow program, Next.js marketplace, Fastify API, provider execution tools, signed receipts, verification, and a recovering account indexer. The name is a working codename.

**Status: live development network on Solana devnet.** The economic path uses the deployed Anchor program and official devnet USDC; InsForge hosts the API, database, authentication, evidence storage, and web application. This remains unaudited software and should not be used with mainnet funds. The original brief is preserved in [docs/ORIGINAL_SPEC.md](docs/ORIGINAL_SPEC.md); design/research are in [BUILD_PLAN](docs/BUILD_PLAN.md) and [OPEN_SOURCE_RESEARCH](docs/OPEN_SOURCE_RESEARCH.md).

Live demo: https://dyr25fzr.insforge.site. API readiness: https://vericompute-api-d538c2c8-0e47-44a3-bc01-d07ab8a2e8f4.fly.dev/ready. Release gates: https://vericompute-api-d538c2c8-0e47-44a3-bc01-d07ab8a2e8f4.fly.dev/v1/release/readiness. Program: `HsjKrSHNqXgqkDmyp1PAhhFAa16GHfeRNZ9s6Zuqpfyd` on Solana devnet. The market only shows signed, indexed supply; it can be empty when no independent provider is online.

The hosted program currently activates VERIFY_0 and VERIFY_1. The source and control-plane paths for VERIFY_2–5 are built, but the stack-safe program upgrade is pending additional devnet SOL for its temporary 3.80 SOL loader buffer. The API advertises this ceiling and rejects unsupported funded jobs instead of returning transactions that will fail on-chain.

## Run

```sh
npm ci
python3 scripts/dev-stack.py
npm run indexer
```

Open http://localhost:3000. API: http://localhost:4000. The hosted InsForge project is already linked locally; application credentials live in ignored `.env.local` files. See [local setup](docs/LOCAL_DEVELOPMENT.md) for program build, deployment, environment, and testing instructions.

## Implemented and exercised

- Real on-chain provider, worker and machine registration; offers, funded jobs, competitive bids, assignment, receipt commitment, independent verifier signature and SPL-token settlement on a local Solana validator.
- Snapshot fee/treasury/verifier, canonical vault, checked accounting and token transfers, dispute/refund paths, terminal-state guards and conservative machine reservation.
- InsForge PostgreSQL migrations, private evidence storage, restricted projection writes, user-owned saved specs, auth UI and wallet ownership proofs.
- Strict job/receipt formats; canonical hashing; Ed25519 signature checking; STANDARD evidence consistency checks; hard-filtered pricing and bid selection.
- Indexer combines finalized live notifications, decoded signature-history recovery, periodic account reconciliation, and market-price snapshots.
- Signed, digest-pinned benchmarks promote matching hardware from CLAIMED to BENCHMARKED. Provider and machine reputation use decayed job, SLA, verification, uptime, and benchmark components.
- Provider stake uses canonical token vaults, a seven-day withdrawal cooldown, resolver-only slashing, and public InsForge projections. Provider, worker, machine, offer and bid management paths are exercised on-chain.
- Bounded agent policies enforce an exact workload Merkle allowlist, daily and per-job spend, runtime, verification and expiry on Solana. Owners approve a capped SPL-token delegation; agents never receive the owner key. The InsForge API and SDK construct owner- and agent-signed transactions.
- Worker journals persist evidence before receipt commitment and recover managed Docker containers or interrupted evidence publication after a daemon restart.
- VERIFY_2 hidden challenges bind the worker, assigned machine, result, latency, GPU UUID commitment, and telemetry commitment. VERIFY_3 redundant jobs create independently funded replicas and require provider/machine independence plus a result quorum.
- V2/V3 execution adapters include database-fenced multi-scheduler leadership, fixed-duration vLLM services on an egress-blocked internal network, Ray Jobs API submission with digest-pinned runtime environments, NVIDIA attestation validation, and pinned Groth16 verification.
- Responsive market UI, cursor-backed inventory loading, intent quote/save/sign-and-fund flow, buyer jobs, owner-signed agent policy creation/revocation, provider onboarding, network and developer pages.
- Docker executor with OPA, immutable images, explicit GPU UUID selection, non-root/read-only/no-network/resource limits, telemetry sampling and cleanup. Providers can require the fail-closed gVisor `runsc` sandbox. An explicit development MockBackend is separate.
- A real CPU workload has completed through both Docker `runc` and gVisor `runsc`, signed receipt verification, SPL-token settlement, private InsForge evidence storage and finalized indexing. Evidence is recorded in [research/e2e-cpu-result.json](research/e2e-cpu-result.json) and [research/e2e-gvisor-result.json](research/e2e-gvisor-result.json).

The three initial provider wallets and GPU claims are controlled localnet fixtures, not commercial supply. Local settlement uses a six-decimal test SPL mint, not mainnet USDC. No payment, bid, state transition or settlement is mocked in chain integration tests.

## Validation

```sh
npm test
npm run test:policy
npm run typecheck
npm run build
npm run test:chain
npm run test:cpu
npm run test:gvisor
npm run test:recovery
npm run test:backend
npm run test:backend:auth
npm run test:management
npm run test:agent-policy
npm run test:verifier-recovery
npm run license:audit
npm run verify:devnet # simulates every policy code without changing chain state
npm run deploy:devnet # public-cluster preflight, deploy and initialization
```

Recorded real-container flow: deposit 100000 → provider 34300 + fee 700 + buyer refund 65000. Duplicate settlement and refund-after-settlement fail. [CPU execution evidence](research/e2e-cpu-result.json). The separate [mock-execution fixture](research/e2e-result.json) exercises competitive GPU-shaped offers without claiming GPU work occurred.

## Still required

- A funded/authenticated NVIDIA cloud host and real GPU/CUDA/inference validation. No GPU cloud credentials were available. The local Colima Linux CPU path passes end to end.
- Independent governance for stake slashing and verifier rotation; the development resolver remains trusted.
- Full chaos/security suite, multi-cluster database isolation, and large-network performance.
- Public authenticated relay and billing for vLLM endpoints; the provider-local fixed-duration service lifecycle is implemented.
- Independent protocol/host audit, mainnet governance, and production operations qualification.
- Resolution of npm audit findings in the pinned Anchor/web3 compatibility dependency tree. See [security status](docs/SECURITY.md) and [audit](research/npm-audit.json).

Never enable TEE or proof assurance for production buyers without qualified hardware and proof circuits. STANDARD, challenge, and redundant evidence are not cryptographic proofs of computation or confidentiality.

## Documentation

[Architecture](docs/ARCHITECTURE.md) · [Protocol](docs/PROTOCOL.md) · [Specification coverage](docs/SPEC_COVERAGE.md) · [Market](docs/MARKET_DESIGN.md) · [Intent](docs/COMPUTE_INTENT.md) · [Job spec](docs/JOB_SPEC.md) · [Receipts](docs/EXECUTION_RECEIPT.md) · [Verification](docs/VERIFICATION.md) · [Provider](docs/PROVIDER_NODE.md) · [Indexer](docs/INDEXER.md) · [SDK](docs/SDK.md) · [MCP](docs/MCP.md) · [Agent policies](docs/AGENT_POLICIES.md) · [Threat model](docs/THREAT_MODEL.md) · [Deployment](docs/DEPLOYMENT.md) · [Third-party notices](THIRD_PARTY_NOTICES.md)
