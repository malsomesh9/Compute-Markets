# Threat model

Assets: buyer escrow, provider payout and worker delegation, protocol treasury, job/result confidentiality, correct assignments, database privacy, and provider host integrity. Adversaries include buyers supplying hostile containers, providers fabricating hardware/results, revoked workers, malicious verifiers, an unavailable or compromised API/indexer/RPC, and cross-tenant users.

Trust boundaries: Solana program → classic token program; wallet → unsigned API transaction; InsForge auth → wallet proof; provider authority → delegated worker; worker → OCI runtime; evidence store → verifier; chain → finalized projection. The backend cannot sign as a buyer. The configured verifier/resolver remain trusted in this MVP.

The twenty concrete threats and mitigations are enumerated in BUILD_PLAN.md. Executed tests cover conservation, unauthorized workers/verifiers, receipt replay/tampering, wrong output bytes, policy downgrade, stale/overbudget candidates, double settlement/refund, anonymous access, tenant isolation, OPA deny rules, stake authorization, and agent allowlist/spend/delegation/revocation bounds. Missing tests include a full chaos matrix, public-chain reorg behavior and malicious GPU-container stress tests.

Residual risks: host kernel/GPU driver escape, internally consistent fabricated telemetry, trusted-verifier/resolver compromise, uncalibrated stake economics, incomplete cross-host recovery, and unresolved transitive dependency advisories. These prevent a production-grade claim.
