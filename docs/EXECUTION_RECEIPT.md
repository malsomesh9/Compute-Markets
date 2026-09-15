# ExecutionReceiptV1

The schema and canonical signature helpers are in `packages/receipts/index.ts`. Fields bind version, domain, cluster genesis, program, job/spec, provider/machine/worker, actual image digest, input/output commitments, start/finish, exit code, GPU UUID commitment, hardware/telemetry, stdout/stderr/result hashes and a UUID nonce.

The worker signs canonical JSON using Ed25519. The signature is outside the payload; the payload's canonical hash is committed to Solana. Off-chain evidence bytes are stored in the private execution-evidence bucket, with both object key and URL retained in InsForge. Repeated or substituted on-chain receipt submissions are rejected.

Outputs are currently bounded stdout as the job result. The verifier recomputes hashes from the supplied bytes and compares the payload to authoritative job/assignment data. A matching commitment does not prove correct compute, physical GPU identity or confidentiality.
