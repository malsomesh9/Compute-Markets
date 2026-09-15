# Market design

A buyer specifies acceptable hardware, pinned workload, start delay, runtime ceiling, assurance and budget. Provider offers are discovery data. The API hard-filters availability, heartbeat freshness, runtime, region, GPU count/model/VRAM, assurance, duration, start delay and price. It ranks surviving offers by price then reputation. Discovery quotes are explicitly non-binding.

A provider's delegated worker submits a signed Solana bid for a specific job/machine/worker, total price, start estimate and expiry. The buyer signs acceptance. The program validates links and budget and reserves one entire machine, which avoids overselling but does not yet optimize multi-GPU sharing. `apps/scheduler/src/select.ts` provides deterministic bid selection; no scheduler owns buyer funds.

Provider and machine reputation are calculated separately from time-decayed completion outcomes, startup/completion SLA, independent receipt verification, fresh heartbeat uptime, and accepted standard benchmarks. A Bayesian prior prevents a single job from producing a perfect score. Five-minute price snapshots and current best/median/p25/p75/utilization are available. Longer-term volume indices, benchmark-variance penalties, stake, and slashing policy still require implementation; the current score is not an anti-Sybil guarantee.
