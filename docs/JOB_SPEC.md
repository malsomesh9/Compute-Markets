# ComputeJobSpecV1

The strict Zod schema is `packages/job-spec/index.ts`. Required fields: version `1`, runtime `oci`, image repository and SHA-256 digest, argv command, bounded GPU/CPU/RAM/storage requirements, runtime/start ceilings, deny-by-default networking with an empty allowlist, and an explicit BASIC, STANDARD, CHALLENGE, REDUNDANT, TEE, or PROOF verification policy. `inputs` defaults to an empty array. Unknown fields are rejected, including privileged runtime options.

Optional `service` requests a fixed-duration vLLM deployment with a model path, context length, and replica count. Optional `distributed` requests a Ray job with a worker count, GPUs per worker, and entrypoint. A job cannot be both. Distributed GPU totals must match the resource request. TEE/confidential-GPU requests require VERIFY_4 or stronger and PROOF requires committed circuit and verification-key hashes.

`canonicalize` implements RFC 8785 serialization, and SHA-256 hashes the UTF-8 canonical bytes. Receipt hashing uses the same primitive. Immutable container image references are mandatory at execution. Tags may only be resolved before constructing the committed spec.

Runtime limits: max 16 GPUs, 128 CPU cores, one day, and bounded arrays/string lengths. Docker uses a maximum 1GiB tmpfs currently, even where schema storage limits are larger; callers must use a supported storage size until explicit disk-backed quotas are implemented. GPU model/VRAM are provider claims, not attestations.
