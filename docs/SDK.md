# SDK

`packages/sdk/index.ts` exports a source-level `ComputeClient`; it is not published to npm. Configure `apiUrl`, an InsForge access token, and a signed wallet-session proof. The proof binds `vericompute:wallet-session:v1`, user ID, wallet public key and a maximum 15-minute expiry. The Next UI signs canonical JSON with the wallet.

Methods: `findCompute`, `quote`, `run`, `createJob`, `bids`, `acceptBid`, `cancelJob`, `settleJob`, `status`, `wait`, `logs`, `result`, `receipt`, `verifications`, `verify`, and `prices`. `findCompute({ limit, cursor })` follows the API's bounded keyset pagination and returns `nextCursor`. Agent methods are `agentPolicies`, `createAgentPolicy`, `updateAgentPolicy`, `revokeAgentPolicy`, `createAgentJob`, `acceptAgentBid`, and `cancelAgentJob`; signed convenience variants end in `AndSign`. `run` quotes supply, creates and funds the intent, waits for bids, accepts the cheapest indexed bid, and returns a `ComputeJobHandle`. Every economic step calls the integrator's explicit `signAndSendTransaction` callback. `verifyReceipt` remains available as a local verification utility.

All amounts are integer base-unit strings; six decimals for the local test mint. A quote is non-binding discovery, not a signed on-chain bid. Providers submit bids; buyers sign acceptance. No API or SDK process receives custody of buyer funds.

Agent policy creation is owner-signed and includes the SPL delegation approval. Subsequent agent job, acceptance, and cancellation transactions require the configured agent key through the same signing callback. Daily, per-job, runtime, verification, workload and expiry bounds are enforced by Solana.
