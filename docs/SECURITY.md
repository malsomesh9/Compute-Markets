# Security and release status

This is an unaudited development implementation. Do not use real-value mainnet funds. Local SPL-token settlement and negative-path checks are recorded in research/e2e-result.json; this is not an external security audit.

The program constrains signers, account ownership, canonical creation seeds, provider/worker/machine relations, fixed classic SPL Token program, mint, escrow vault, recipient owners, price/fee bounds and terminal state. Fees, treasury, verifier and resolver are snapshotted into each job. Settlement conserves the accounted deposit and is atomic. Refunded jobs cannot settle. A machine's active-job pointer prevents an old refunded job from releasing a newer assignment.

The protocol allows only one active assignment per machine. Provider collateral has a canonical vault, delayed withdrawal and resolver-controlled slashing. Agent token delegation is bounded by on-chain policy and a standard SPL allowance. Authority transfer, decentralized slashing, multi-verifier consensus and separate verification/dispute accounts remain absent.

Off-chain: RLS and grants restrict private tables and all projection writes. Wallet ownership proof is required for private job API access. InsForge's storage RLS is explicitly enabled; evidence is accessible through the authorized API/admin path. The browser receives only an anon key. JSON bodies and evidence uploads are bounded; no arbitrary input URL is fetched.

Dependency audit has unresolved findings in the legacy Anchor/web3 dependency tree, including bigint-buffer and toml. The lockfile and research/npm-audit.json retain the evidence. Do not use `npm audit fix --force` to silently downgrade SPL Token or claim these findings were fixed. Remove or upgrade the affected compatibility boundary before production.

The verifier daemon scans finalized VERIFYING jobs and also repairs missing database decisions for already-finalized COMPLETED or FAILED jobs, covering interruption between chain submission and InsForge persistence.

Host isolation is defense in depth, not a confidentiality guarantee. Providers can require gVisor `runsc`; runtime availability and recovery identity fail closed, and a full CPU flow is exercised in the sandbox. GPU deployments still require `nvproxy` and driver-specific qualification. Resource accounting, output storage quotas and an external audit remain release requirements.
