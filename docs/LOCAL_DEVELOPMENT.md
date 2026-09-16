# Local development

InsForge is already provisioned and linked as `vericompute-backup`, API `https://vxq35sgz.ap-southeast.insforge.app`. Keep `.env.local`, `.insforge/project.json`, and `keys/` private. The root server environment and `apps/web/.env.local` are populated locally; only anon credentials belong in the browser.

```sh
npm ci
python3 scripts/dev-stack.py
npm run indexer
```

The launcher starts missing services on 8899 (validator), 4000 (Fastify), and 3000 (Next). It preserves an existing ledger and never resets it. Logs and PIDs are under `.insforge/`. It does not kill an occupied port; check that an existing service belongs to this project.

Build the program using the installed, compatible toolchain:

```sh
export PATH="$HOME/.cargo/bin:$HOME/.local/share/solana/install/active_release/bin:$PATH"
cargo-build-sbf --manifest-path programs/compute-market/Cargo.toml --tools-version v1.54 --arch v3
anchor idl build -o target/idl/compute_market.json
solana program deploy target/deploy/compute_market.so \
  --program-id target/deploy/compute_market-keypair.json \
  --keypair keys/local-admin.json --url http://127.0.0.1:8899
```

This local validator reports Agave 4.2.0 and accepts the v3 artifact. The unqualified Homebrew CLI reports an older version; put the installed Agave directory first. An initial v0 deployment failed with an unsupported SBF version; rebuilding v3 resolved it. Do not infer a devnet/mainnet deployment from this local deployment.

The program ID is tied to the local `target/deploy/compute_market-keypair.json`. On a new checkout, generate a new development program keypair, update `declare_id!` and Anchor.toml, and rebuild. Do not use a program ID without its deployment authority.

```sh
npm test
npm run test:policy
npm run typecheck
npm run build
npm run test:chain
npm run test:backend
npm run test:backend:auth
npm run test:cpu
```

`test:chain` explicitly enables mock execution and uses real local-validator SPL token accounts, bids, receipts, verification, settlement, and hosted InsForge projections. Its three provider wallets are controlled test fixtures, not independent commercial suppliers. Re-running adds fresh machine/job records on the same local ledger.

Real CPU execution uses `tests/chain.cpu.e2e.ts` and a private Colima Docker profile. The immutable Alpine image digest is resolved before committing the job spec. The test passes through container execution, receipt verification, settlement, private evidence upload and finalized indexing. This remains separate from NVIDIA validation.

`test:backend:auth` creates two disposable verified test identities, checks cross-tenant RLS and signed-wallet API boundaries, and removes both identities and their rows before exiting.

```sh
DOCKER_CONFIG="$PWD/keys/docker" \
DOCKER_HOST="unix://$HOME/.colima/vericompute/docker.sock" \
npx tsx --env-file=.env.local tests/chain.cpu.e2e.ts
```

Do not delete `.local-ledger/` while keeping hosted projections and assume they refer to a new genesis. A fresh genesis requires a separate InsForge project or explicit development-data cleanup and fresh cursors. Multi-cluster indexing into one database is not supported yet.
