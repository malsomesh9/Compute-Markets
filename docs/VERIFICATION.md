# Verification

`packages/verification/index.ts` validates worker Ed25519 signature, domain, cluster genesis, program, assigned job/provider/machine/worker, actual on-chain specification hash and requested assurance policy, image digest, input and output roots, hardware commitment, telemetry commitment, log/result bytes, exit code and timing. Current delegation must be active. Binding the supplied specification to the on-chain hash prevents substituting a self-consistent alternative spec or downgrading policy.

BASIC is VERIFY_0; STANDARD is VERIFY_1. They establish an attributable execution claim and evidence consistency, not correct computation, physical GPU identity, or confidentiality. Telemetry can be fabricated by an adversarial provider.

CHALLENGE is VERIFY_2. After receipt commitment, the API issues an unpredictable, short-lived challenge bound to the assigned job, machine, and worker. The signed response must meet the expected result and latency bound and repeat the receipt's GPU UUID and telemetry commitments. REDUNDANT is VERIFY_3. The API constructs separately funded replica transactions, prevents a provider from winning more than one replica in a group, and the verifier requires independent provider and machine identities plus a result-hash quorum.

TEE is VERIFY_4 and PROOF is VERIFY_5. The adapters validate NVIDIA attestation claims against a verifier nonce and use `snarkjs` to verify a Groth16 proof against committed public inputs and a pinned verification key. These policies fail closed unless their additional evidence is present. They still require qualified confidential-GPU infrastructure and circuit-specific production integration before a buyer should select them.

The protocol snapshots a configured verifier for each job. Worker and provider payout authorities cannot serve as that job's verifier. This is a trusted-verifier MVP, not a permissionless verifier market.

`VERIFIER_KEYPAIR=keys/verifier.json npm run verifier` watches indexed jobs and uploaded receipt bundles. `apps/verifier/src/main.ts BUNDLE_FILE` verifies a bundle directly. The verifier reads finalized job state and submits the exact receipt hash with its decision. Evidence and decisions persist in InsForge. A verification failure allows refund; a success begins the dispute window.

The verifier daemon repairs an interrupted persistence step by scanning finalized COMPLETED and FAILED jobs without a database decision, recomputing the evidence result, checking that it agrees with the chain outcome, and writing the missing InsForge record without resubmitting the chain instruction.

Unfinished release work: permissionless verifier compensation and arbitration, qualified confidential-GPU hosts, production proof circuits, and an independent audit.
