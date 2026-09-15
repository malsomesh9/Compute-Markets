# Provider node

Use a Linux NVIDIA host for GPU workloads. `infra/scripts/gpu-host-check.sh` checks Docker, OPA, NVIDIA visibility and a digest-pinned CUDA container. It does not rent a GPU or provision credentials. No GPU-cloud account was available in the working environment.

Authority operations run on an operator workstation, never the execution host:

```sh
AUTHORITY_KEYPAIR=keys/provider.json npx tsx --env-file=.env.local scripts/chain-transactions.ts register-provider MyProvider
AUTHORITY_KEYPAIR=keys/provider.json npx tsx --env-file=.env.local scripts/chain-transactions.ts authorize-worker WORKER_PUBLIC_KEY
AUTHORITY_KEYPAIR=keys/provider.json npx tsx --env-file=.env.local scripts/chain-transactions.ts register-machine hardware.json
AUTHORITY_KEYPAIR=keys/provider.json npx tsx --env-file=.env.local scripts/chain-transactions.ts create-offer MACHINE_ADDRESS BASE_UNITS_PER_SECOND
```

`WORKER_KEYPAIR` points to the delegated Ed25519 worker file; `MACHINE_ID`, `HARDWARE_REPORT`, `RATE_BASE_UNITS_PER_SECOND`, `COMPUTE_API_URL`, `ALLOWED_REGISTRIES`, and `OCI_RUNTIME` configure the daemon. Ray jobs additionally use `RAY_JOBS_ADDRESS` and optional `RAY_API_TOKEN`. `npm run worker` signs heartbeats, checks open intents, signs eligible bids, and executes assignments. The buyer chooses the bid; the worker cannot withdraw escrow or change treasury.

`cli.ts status`, `detect`, `benchmark`, `heartbeat`, `execute JOB SPEC_FILE HARDWARE_FILE`, and `recover JOB SPEC_FILE HARDWARE_FILE` are independently usable. `benchmark` runs a digest-pinned, network-isolated standard container, compares live GPU identity with the committed report, signs measurements with the delegated worker, and submits them to InsForge. A passing standard benchmark is BENCHMARKED, not attested.

Docker execution: digest-pinned image; OPA policy; explicit argv; no root/host mounts/network/privilege; read-only root; cap-drop; no-new-privileges; bounded CPUs/RAM/PIDs/logs/runtime; tmpfs working storage. NVIDIA selection uses assigned UUIDs and Container Toolkit's `--gpus`. Telemetry uses `nvidia-smi`; DCGM export configuration is included for operations but its aggregate ingestion is not yet implemented. Container execution is not a complete protection against kernel/GPU-driver vulnerabilities.

Set `OCI_RUNTIME=runsc` to require gVisor. The executor checks Docker's registered runtimes before pulling or creating a container, includes `--runtime runsc`, and refuses recovery if the existing container used a different runtime. On Ubuntu/Debian hosts, `infra/scripts/install-gvisor-ubuntu.sh` installs from gVisor's signed repository and runs a sandbox smoke test. GPU hosts additionally need gVisor `nvproxy` and a supported NVIDIA driver/GPU combination; qualify that combination before accepting GPU work. `npm run test:gvisor` exercises the full CPU escrow-to-settlement flow inside `runsc`.

The atomic state journal lives in `keys/journal/`. Evidence is persisted before the receipt transaction. On restart, the daemon reattaches only to a managed container with the exact committed image, or republishes durable evidence when the receipt is already on-chain. A pre-existing journal rejects a second ordinary execution. Cross-host recovery still requires moving the protected journal and evidence files with the workload host.

The Docker implementation materializes no arbitrary input URLs, mounts, or secrets. Nonempty `inputs` fail closed. This limits workloads until scoped input staging is implemented. Fixed-duration vLLM containers run on an internal Docker network with egress blocked and publish only a loopback endpoint for the provider relay. A public authenticated relay is still required for a remotely usable service product.
