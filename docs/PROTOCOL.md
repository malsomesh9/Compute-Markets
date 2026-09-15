# Protocol implementation

Implemented instructions: initialize_protocol, update_protocol, pause_protocol, register_provider, update_provider, authorize_worker, revoke_worker, rotate_worker, register_machine, update_machine, deactivate_machine, create_offer, update_offer, pause_offer, close_offer, create_job, create_agent_job, fund_job, place_bid, cancel_bid, accept_bid, accept_agent_bid, assign_offer, start_job, submit_receipt, submit_verification, cancel_job, cancel_agent_job, expire_job, open_dispute, resolve_dispute, settle_job, refund_job, release_machine, initialize_provider_stake, deposit_stake, request_unstake, cancel_unstake, withdraw_stake, slash_stake, create_agent_policy, update_agent_policy and revoke_agent_policy.

Accounts: ProtocolConfig, Provider, ProviderStake, AgentPolicy, WorkerAuthorization, Machine, Offer, Job and Bid. Assignment, escrow accounting, receipt commitment, verification status and dispute state are stored inside Job; token vaults are separate canonical SPL accounts.

Initialize is constrained to the program's upgrade authority, preventing a third party from front-running config. Config pins approved mint, treasury, fee, verifier and resolver. Job creation snapshots them. Fee basis points are capped at 300. Classic SPL Token and checked transfer CPI are fixed; Token-2022 is not accepted implicitly.

Transitions are instruction-specific. Funding atomically deposits the exact budget and opens the job. Accepting a bid atomically matches/assigns and reserves the machine. Starting moves to RUNNING. A single receipt commitment moves to VERIFYING. A verifier decision completes or fails the job. COMPLETED means verified; `settled` separately indicates token payment after the dispute period. Cancellation is allowed only before assignment. Expiry covers missed start, execution timeout plus a 60s submission allowance, or a 24h verifier outage.

Settlement: deposit = provider_paid + fee_paid + refunded. Price includes the protocol fee. Payout/refund/treasury token owners and mint are pinned. A successful settlement releases machine capacity and increments completion counters. Failed/cancelled/expired jobs refund the deposit; an assigned refunded machine can be released only when its active-job pointer matches that exact job. A buyer dispute freezes payout. Resolver awards are bounded by the winning price.

Agent policies use `[agent-policy, owner, agent]`. A sorted-pair SHA-256 Merkle root commits the exact allowed job-spec hashes. The program enforces policy activity and expiry, daily and per-job budgets, a runtime ceiling, minimum verification, proof depth, and the owner token account's live delegate and remaining allowance. Budget is reserved conservatively when a job is created and is not released from that day's counter after a refund.

Provider stake uses `[stake, provider]` and `[stake-vault, provider]`. Withdrawal has a seven-day cooldown. Only the configured resolver can slash; slashing also caps a pending withdrawal to the remaining balance.

Still missing from the contract: provider authority transfer, reuse of a revoked worker PDA, separate verification/dispute accounts, multiple verifiers, and decentralized slashing governance. The contract has not undergone an independent security audit.
