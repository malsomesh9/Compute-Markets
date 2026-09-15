# Agent policies

`AgentPolicy` is an on-chain bounded authority from an owner wallet to one agent key. It pins the settlement mint, daily spend, single-job spend, runtime ceiling, minimum verification level, exact workload allowlist root, expiry, day counter and active flag.

The workload allowlist is a sorted-pair SHA-256 Merkle tree over canonical job-spec hashes. `packages/agent-policy` builds roots and proofs. An exact hash allowlist avoids trusting a backend to interpret mutable repository names or GPU labels. Proof depth is capped at 16, allowing up to 65,536 leaves.

Creating a policy returns one owner-signed transaction containing a standard SPL Token `Approve` instruction and `create_agent_policy`. The agent becomes a delegate for the configured allowance; it does not receive the owner key or own the token account. Every agent job checks the live delegate and remaining allowance before moving tokens into the canonical escrow.

The `/agents` owner dashboard creates policies, lists indexed usage, and constructs revocation transactions. The MCP gateway exposes policy reads plus agent job creation, bid acceptance, and cancellation; an external trusted agent signer submits those unsigned transactions.

`create_agent_job` atomically validates and reserves the daily budget, creates the job and escrow, transfers the budget, and opens the job. `accept_agent_bid` and `cancel_agent_job` recheck activity, expiry, runtime, verification, and the workload proof. Revocation prevents later agent actions. Owner-signed job actions remain available.

The daily counter rolls over by Unix UTC day inside the transaction. Reservations are conservative: cancellation or refund returns tokens but does not restore that day's policy budget. This prevents repeated create/cancel cycles from bypassing the daily cap.

The InsForge projection is private. API access requires a valid InsForge session and wallet ownership proof. SDK methods are `agentPolicies`, `createAgentPolicy`, `updateAgentPolicy`, `revokeAgentPolicy`, `createAgentJob`, `acceptAgentBid`, and `cancelAgentJob`, with matching `AndSign` helpers.

Current limits: allowlists cover exact canonical specs rather than broad registry/GPU predicates; one SPL delegate allowance spans the policy lifetime and may need an owner-signed refresh; policy spend has no same-day release; autonomous API calls still need a current owner-authorized API session to construct transactions. The Solana program remains the enforcement boundary.
