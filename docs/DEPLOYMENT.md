# Deployment

## Current deployment

The live devnet application is deployed at https://dyr25fzr.insforge.site. Its Fastify service runs in InsForge Compute at https://vericompute-api-d538c2c8-0e47-44a3-bc01-d07ab8a2e8f4.fly.dev. InsForge also hosts the database, authentication and private evidence bucket.

The service is configured with `SOLANA_NETWORK=devnet`, `RUN_INDEXER=true`, and `PUBLIC_READ_ONLY=false`. `/health` reports process liveness and `/ready` validates the devnet genesis hash and executable program account. The deployed protocol configuration uses official devnet USDC (`4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`), a 2% fee, and a one-hour dispute period. Empty inventory means that no independent provider currently has a fresh signed heartbeat.

## Public-chain promotion

The program artifact is `target/deploy/compute_market.so` and its program ID is `HsjKrSHNqXgqkDmyp1PAhhFAa16GHfeRNZ9s6Zuqpfyd`. `npm run deploy:devnet` validates that the binary, IDL and program keypair match, checks the deployer's balance, deploys with an exact maximum length, verifies the configured six-decimal settlement mint, initializes protocol configuration and creates the treasury token account.

The command requires `TREASURY_PUBKEY`, `VERIFIER_PUBKEY`, and either `SETTLEMENT_MINT` or the explicit development-only flag `CREATE_TEST_MINT=true`. It defaults to the Solana CLI keypair and the devnet RPC. The deployed canonical config PDA is `Ac56m2EvF6nVWoczfTNKDZG5TvwvyTmG8xQ6cXyFZRgs`.

After each upgrade, verify the ProgramData authority and slot, confirm the canonical protocol configuration, deploy the API with the matching IDL, and recheck `/ready` before enabling transactions in the frontend.

## Operations

`.env.local` is server-only. Browser config is in `apps/web/.env.local`. Never pass `INSFORGE_API_KEY`, worker keys, or verifier keys to a frontend deployment. Generate deployment keys separately from development keys and use a multisig upgrade authority.

`Dockerfile` packages the API/indexer code and generated IDL; it intentionally excludes local keys, backend credentials and ledger data. `compose.yaml` uses the configured InsForge backend and optional monitoring/cache profiles. A Linux deployment must set a real RPC URL reachable from its containers, an allowed web origin, and a separate verifier/worker key distribution mechanism. The root image does not include a provider's privileged Docker socket.

InsForge's CLI supports backend CPU containers and frontend deployment; it does not expose NVIDIA GPU types through its documented compute service. A funded, authenticated external GPU provider is required to rent an NVIDIA test host. None was configured in this workspace. The local Colima VM provides Linux CPU testing only.

Before a mainnet production release: validate live NVIDIA workloads and timeout/kill behavior, test RPC/indexer outages, address the pinned Anchor/web3 dependency audit findings, move upgrade/resolver authority to an independently controlled multisig, and obtain an independent protocol/host security review.
