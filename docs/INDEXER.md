# Indexer

`apps/indexer/src/indexer.ts` combines a finalized program-account subscription, signature-history backfill, and periodic finalized `getProgramAccounts` reconciliation through Solana Kit. The history watermark is independent of live notifications and advances only after complete persistence plus reconciliation. Restart from an old watermark replays idempotently.

Projections follow provider → worker → machine → offer → job → bid order to respect foreign keys. `apply_projection` is restricted to the admin role and an explicit table allowlist. It updates only when the incoming slot is at least the stored slot. It preserves original `created_at`. These tables are projections, never authority to spend funds.

Signature history is stored in `chain_events`. Finalized transactions are fetched and Anchor events are decoded into event name/data fields; an idempotent pending pass repairs earlier unavailable transactions. Account reconciliation remains the source of current correctness, while decoded events provide each owned job's signature timeline through the proof-gated API. Five-minute offer snapshots populate `market_price_history`. Websocket reconnection is delegated to the RPC client; periodic backfill remains necessary.

One deployment handles one cluster/genesis and program. Do not reset the validator and mix new genesis state into this database. Public offer and provider inventory uses bounded keyset pagination. High-volume reputation aggregation and ingestion still need load testing.
