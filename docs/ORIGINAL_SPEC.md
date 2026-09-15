You are acting as:

* Principal Solana protocol engineer
* Distributed systems architect
* GPU infrastructure engineer
* AI inference infrastructure engineer
* Marketplace/economic mechanism designer
* Security engineer
* Open-source code researcher
* DevOps/SRE engineer
* Product architect

Your goal is to research, architect, implement, test, and document a production-grade:

# SOLANA-NATIVE VERIFIABLE COMPUTE EXCHANGE

Working codename:

VERICOMPUTE

The name must remain replaceable.

The product is:

“An open spot market where humans and autonomous AI agents can discover, purchase, execute, verify, and settle GPU/CPU compute through Solana.”

This is NOT merely:

“Rent my GPU.”

It should combine ideas from:

Nosana
Akash
Prime Intellect
Bacalhau
Ray/KubeRay
modern cloud spot markets
container runtimes
GPU telemetry systems

while introducing a differentiated Solana-native execution-verification and agent procurement layer.

# CRITICAL REQUIREMENT

Do not reinvent functionality that strong open-source projects already implement.

Before implementing each major subsystem:

1. Inspect the relevant repositories below.
2. Understand their architecture.
3. Identify reusable modules/patterns.
4. Check LICENSE.
5. Record what is being reused.
6. Adapt architecture to Solana.
7. Do NOT blindly copy unaudited or incompatible code.
8. Preserve attribution and license notices when required.

Never access, request, reconstruct, or claim access to proprietary company source code.

Only use code that is publicly available.

Create:

docs/OPEN_SOURCE_RESEARCH.md

and

THIRD_PARTY_NOTICES.md

before shipping.

# ============================================================

# PART 1 — OPEN-SOURCE RESEARCH SOURCES

# ============================================================

## SOURCE A — NOSANA PROGRAMS

Repository:

nosana-ci/nosana-programs

Link:

[Nosana Programs GitHub](https://github.com/nosana-ci/nosana-programs?utm_source=chatgpt.com)

Documentation:

[Nosana Programs Documentation](https://learn.nosana.com/programs/start.html?utm_source=chatgpt.com)

License:

MIT.

Important warning:

The repository itself warns that much of the code is unaudited.

Therefore:

DO NOT blindly fork and deploy it.

Study and selectively reuse patterns with independent security review.

Research:

programs/jobs

market accounts

job accounts

run accounts

job state machines

node registration

market queues

job pricing

job listing

node pickup

job completion

reward settlement

staking

PDA architecture

Anchor tests

upgrade/deployment patterns.

Nosana currently exposes four Solana programs covering jobs, staking, pools and rewards.

Your implementation should learn from their architecture but introduce:

USDC settlement

compute intents

competitive bids

execution receipts

verification policies

worker-key delegation

provider reputation

agent spending policies.

## SOURCE B — NOSANA KIT

Repository:

nosana-ci/nosana-kit

Link:

[Nosana Kit GitHub](https://github.com/nosana-ci/nosana-kit?utm_source=chatgpt.com)

Study:

SolanaService

TokenService

JobsProgram

market querying

run querying

job querying

PDA calculations

RPC monitoring

client architecture.

Nosana Kit currently exposes jobs, runs and market objects and distinguishes states such as queued, running, completed and stopped.

Use these concepts when designing our TypeScript SDK.

Do NOT hard-code our protocol around NOS.

Our default economic unit is USDC.

## SOURCE C — NOSANA NODE

Repository:

nosana-ci/nosana-node

Link:

[Nosana Node GitHub](https://github.com/nosana-ci/nosana-node)

Also study:

nosana-ci/nosana-cli

[Nosana CLI GitHub](https://github.com/nosana-ci/nosana-cli?utm_source=chatgpt.com)

Research:

provider startup

Docker/Podman integration

container job execution

GPU activation

job polling

node lifecycle

job-result handling

CLI architecture

wallet handling

worker runtime.

Nosana's public CLI currently supports starting nodes and executing container jobs using Docker or Podman.

Use concepts where useful.

Our worker implementation must improve isolation substantially.

## SOURCE D — NOSANA INDEXER

Repository:

nosana-ci/indexer

Link:

[Nosana Indexer GitHub](https://github.com/nosana-ci/indexer?utm_source=chatgpt.com)

This is an especially important reference.

Study its:

Solana WebSocket monitoring

PostgreSQL projections

job indexing

market indexing

run indexing

periodic GPA backfill

program transaction indexing

signature history recovery

cursor/watermark architecture

REST API

metrics.

Important design lesson:

Do NOT trust WebSocket events alone.

Our indexer must combine:

LIVE SUBSCRIPTION
+
PERIODIC STATE RECONCILIATION
+
TRANSACTION HISTORY BACKFILL.

Implement this architecture.

## SOURCE E — NOSANA DEPLOYMENT MANAGER

Repository:

nosana-ci/nosana-deployment-manager

Link:

[Nosana Deployment Manager GitHub](https://github.com/nosana-ci/nosana-deployment-manager?utm_source=chatgpt.com)

Study:

deployment revision model

replicas

task scheduling

API/worker process separation

Solana RPC monitoring

worker pools

health endpoints

Prometheus instrumentation

graceful shutdown

deployment lifecycle.

Do not necessarily reuse MongoDB.

Our primary persistence should initially be PostgreSQL unless research shows a strong reason otherwise.

## SOURCE F — AKASH PROVIDER

Repository:

akash-network/provider

Link:

[Akash Provider GitHub](https://github.com/akash-network/provider?utm_source=chatgpt.com)

License:

Apache-2.0.

This is one of the most important references.

Study:

bidengine/

cluster/

event/

gateway/

manifest/

provider-services

pricing mechanisms

provider inventory

lease lifecycle

Kubernetes orchestration.

Akash's bid engine observes orders and places bids based on provider pricing, while its cluster subsystem deploys winning workloads to provider infrastructure.

Adapt that idea to:

Solana compute intents
→ provider quote
→ bid
→ assignment
→ execution.

Do NOT port Akash blockchain-specific code.

Port concepts.

## SOURCE G — AKASH NODE

Repository:

akash-network/node

Link:

[Akash Node GitHub](https://github.com/akash-network/node?utm_source=chatgpt.com)

License:

Apache-2.0.

Study:

marketplace state

orders

bids

leases

economic lifecycle

resource specification.

Compare its order/bid/lease model against Nosana's market/job/run model.

Document the differences.

## SOURCE H — PRIME INTELLECT PROTOCOL

Repository:

PrimeIntellect-ai/protocol

Link:

[Prime Intellect Protocol GitHub](https://github.com/PrimeIntellect-ai/protocol?utm_source=chatgpt.com)

License:

Apache-2.0.

IMPORTANT:

This repository was archived on January 27, 2026.

Treat it as RESEARCH MATERIAL.

Do not make an archived project the critical dependency of our production system.

Study:

worker architecture

validator architecture

discovery service

orchestrator

random challenges

container execution

task dispatch

peer coordination.

Their architecture explicitly separated:

economic smart contracts

discovery

orchestrator

validators

workers.

We want a related modular separation, but with Solana as the economic/state layer.

## SOURCE I — PRIME INTELLECT CLI / SDK

Repository:

PrimeIntellect-ai/prime

Link:

[Prime Intellect Prime CLI/SDK GitHub](https://github.com/PrimeIntellect-ai/prime?utm_source=chatgpt.com)

License:

MIT.

Study product/SDK UX for:

GPU availability

GPU type filtering

pod lifecycle

remote environments

sandbox management

logs

metrics

SSH

team resources.

Do not copy their API blindly.

Build an even simpler agent-oriented procurement API.

## SOURCE J — PRIME DISTRIBUTED TRAINING

Repository:

PrimeIntellect-ai/prime-diloco

Link:

[Prime DiLoCo GitHub](https://github.com/PrimeIntellect-ai/prime-diloco?utm_source=chatgpt.com)

License:

Apache-2.0.

Study this only for future:

multi-provider distributed training

fault-tolerant device meshes

heartbeats

elastic membership

distributed checkpoints.

This is NOT MVP functionality.

## SOURCE K — BACALHAU

Repository:

bacalhau-project/bacalhau

Link:

[Bacalhau GitHub](https://github.com/bacalhau-project/bacalhau?utm_source=chatgpt.com)

License:

Apache-2.0.

Study:

orchestrator/compute-node architecture

job specifications

execution engines

Docker execution

WASM execution

storage adapters

publisher adapters

batch jobs

service jobs

daemon jobs

distributed scheduling.

Bacalhau's architecture already separates orchestration, compute nodes, execution engines and storage backends.

Reuse this MODULARITY concept heavily.

## SOURCE L — RAY

Repository:

ray-project/ray

Link:

[Ray GitHub](https://github.com/ray-project/ray?utm_source=chatgpt.com)

Use for future distributed AI workloads.

Study:

resource scheduling

GPU allocation

distributed actors

task fault tolerance

placement groups

Ray Serve.

Do not make Ray mandatory for single-machine MVP jobs.

Create:

ExecutionBackend

with implementations:

OCIContainerBackend

RayBackend

later.

## SOURCE M — KUBERAY

Repository:

ray-project/kuberay

Link:

[KubeRay GitHub](https://github.com/ray-project/kuberay)

License:

Apache-2.0.

Use later for multi-node GPU clusters and distributed workloads.

## SOURCE N — NVIDIA CONTAINER TOOLKIT

Repository:

NVIDIA/nvidia-container-toolkit

Link:

[NVIDIA Container Toolkit GitHub](https://github.com/NVIDIA/nvidia-container-toolkit?utm_source=chatgpt.com)

License:

Apache-2.0.

This should be a primary GPU execution dependency.

Use it to execute OCI containers with NVIDIA GPUs.

Do NOT reinvent NVIDIA container GPU integration.

## SOURCE O — NVIDIA DCGM EXPORTER

Repository:

NVIDIA/dcgm-exporter

Link:

[NVIDIA DCGM Exporter GitHub](https://github.com/NVIDIA/dcgm-exporter?utm_source=chatgpt.com)

License:

Apache-2.0.

Use GPU telemetry for:

GPU UUID

utilization

memory use

temperature

clock

power

health

execution evidence.

DCGM exporter exposes NVIDIA GPU telemetry to Prometheus.

Use normalized telemetry summaries in ExecutionReceipt.

Do not put telemetry streams directly on Solana.

## SOURCE P — VLLM

Repository:

vllm-project/vllm

Link:

[vLLM GitHub](https://github.com/vllm-project/vllm)

License:

Apache-2.0.

Use vLLM as the first optimized AI inference workload adapter.

Support:

OpenAI-compatible endpoints

model serving

GPU inference

persistent deployments.

vLLM is currently an open-source high-throughput LLM inference/serving engine.

Do NOT bake vLLM into the protocol.

Make it a workload template.

## SOURCE Q — CONTAINERD

Repository:

containerd/containerd

Link:

[containerd GitHub](https://github.com/containerd/containerd)

License:

Apache-2.0.

Use as a future/production-grade runtime abstraction.

Initial MVP may integrate Docker.

Production worker should allow:

Docker
containerd
gVisor
Firecracker.

## SOURCE R — OCI RUNTIME SPEC

Repository:

opencontainers/runtime-spec

Link:

[OCI Runtime Specification GitHub](https://github.com/opencontainers/runtime-spec)

License:

Apache-2.0.

Design ComputeJobSpec so workloads map cleanly onto OCI semantics.

## SOURCE S — GVISOR

Repository:

google/gvisor

Link:

[gVisor GitHub](https://github.com/google/gvisor)

License:

Apache-2.0.

Use for hardened sandboxing of untrusted customer containers where compatible.

The marketplace must assume customer code is malicious.

## SOURCE T — FIRECRACKER

Repository:

firecracker-microvm/firecracker

Link:

[Firecracker GitHub](https://github.com/firecracker-microvm/firecracker)

License:

Apache-2.0.

Future security tier:

OCI container
→ gVisor
→ microVM
→ confidential VM.

Firecracker should not block MVP.

## SOURCE U — OPEN POLICY AGENT

Repository:

open-policy-agent/opa

Link:

[Open Policy Agent GitHub](https://github.com/open-policy-agent/opa)

License:

Apache-2.0.

Use OPA/Rego to enforce provider execution policies.

Examples:

deny privileged containers

deny host networking

deny host PID

deny Docker socket

deny host filesystem mounts

deny forbidden registries

deny excessive resource limits

deny unrestricted outbound network.

## SOURCE V — VALKEY

Repository:

valkey-io/valkey

Link:

[Valkey GitHub](https://github.com/valkey-io/valkey)

License:

BSD-3-Clause.

Use instead of depending heavily on Redis licensing.

Use for:

short-lived scheduler state

distributed locks

queues

rate limiting

cache

heartbeats.

## SOURCE W — OPENTELEMETRY

Repository:

open-telemetry/opentelemetry-js

Link:

[OpenTelemetry JS GitHub](https://github.com/open-telemetry/opentelemetry-js)

License:

Apache-2.0.

Use for:

traces

metrics

service correlation

job lifecycle observability.

## SOURCE X — LIBP2P

Repository:

libp2p/rust-libp2p

Link:

[rust-libp2p GitHub](https://github.com/libp2p/rust-libp2p)

Use only when decentralized provider discovery becomes necessary.

Do NOT create a P2P network for MVP unless it improves a concrete requirement.

Start with:

signed provider API
+
Solana registry
+
event-driven scheduler.

P2P discovery can come later.

## SOURCE Y — SOLANA KIT

Repository:

anza-xyz/kit

Link:

[Solana Kit GitHub](https://github.com/anza-xyz/kit)

This is the modern Solana JavaScript SDK.

Before implementation, determine the current stable version.

Do NOT generate code based on an outdated web3.js API unless a dependency requires it.

## SOURCE Z — ANCHOR

Repository:

solana-foundation/anchor

Link:

[Anchor GitHub](https://github.com/solana-foundation/anchor)

License:

Apache-2.0.

Use Anchor for the Solana program unless current research identifies a strong reason not to.

Check the current stable release before pinning dependencies.

# ============================================================

# SOURCES TO STUDY BUT NOT COPY BLINDLY

# ============================================================

## IO.NET

Public organization:

ionet-official

[io.net GitHub organization](https://github.com/ionet-official?utm_source=chatgpt.com)

Its public organization exposes setup scripts, launcher binaries, docs and demos, but do NOT assume its complete internal compute-market backend is open-source.

Study public:

worker onboarding

hardware setup

Ray demos

installation UX.

Do not invent inaccessible source code.

## GOLEM

Organization:

golemfactory

[Golem GitHub organization](https://github.com/golemfactory?utm_source=chatgpt.com)

Useful for:

requestor/provider architecture

P2P marketplace concepts

payments

provider model.

However many Golem components are GPL-licensed.

Architecture study is fine.

Do not copy GPL source into a permissively licensed proprietary-compatible codebase without deliberate legal/licensing analysis.

## FLUENCE NOX

Repository:

fluencelabs/nox

[Fluence Nox GitHub](https://github.com/fluencelabs/nox?utm_source=chatgpt.com)

Useful historically for distributed worker/peer architecture.

However:

the repository is archived

and

AGPL-3.0 licensed.

Use as architecture research only.

## MINIO

Repository:

minio/minio

[MinIO GitHub](https://github.com/minio/minio)

Do NOT make it the default foundation.

As of 2026 the community repository is archived and AGPLv3.

Instead implement:

ObjectStorage

interface.

Adapters:

S3

local filesystem

other compatible services.

# ============================================================

# PART 2 — PRODUCT THESIS

# ============================================================

Existing decentralized compute markets usually optimize one or more of:

hardware supply

GPU rental

container jobs

provider rewards

distributed deployment.

We will differentiate on:

# PROGRAMMABLE PROCUREMENT + VERIFIABLE SETTLEMENT

Core primitive:

COMPUTE INTENT.

A compute intent describes:

WHAT needs to execute

WHAT hardware is acceptable

HOW much the buyer will pay

WHEN it must start

HOW execution must be verified

WHAT data-access policy is allowed

WHAT result must be returned.

Example:

{
"gpu": {
"count": 1,
"minVramGb": 24,
"models": [
"RTX4090",
"A100",
"H100"
]
},

"runtime": "oci",

"image":
"ghcr.io/acme/inference@sha256:...",

"timeoutSeconds": 900,

"deadlineSeconds": 30,

"maxTotalUsd": 0.30,

"verification": "STANDARD",

"networkPolicy": "DENY_BY_DEFAULT"
}

Then:

Buyer/Agent
↓
Compute Intent
↓
Solana commitment
↓
Provider discovery
↓
Competitive quotes
↓
Best provider selected
↓
USDC escrow
↓
Execution
↓
Signed receipt
↓
Verification
↓
Settlement.

# ============================================================

# PART 3 — WHAT MAKES THIS DIFFERENT

# ============================================================

Build seven differentiators.

## 1. AGENT-NATIVE PROCUREMENT

An AI agent can programmatically buy compute.

SDK:

const result = await compute.run({
image,
command,
resources: {
gpu: "RTX4090",
vramGb: 24
},
maxSpendUsd: 0.30,
verification: "STANDARD"
});

No manual marketplace interaction should be required.

## 2. REVERSE AUCTION

Instead of forcing every GPU type into static markets:

buyer posts intent

providers submit quotes

scheduler evaluates quotes

job gets matched.

Support later:

instant offers

reverse auction

reserved compute

interruptible compute.

## 3. USDC ESCROW

Do not require a new protocol token.

Buyer pays USDC.

Solana program owns escrow.

Provider receives USDC when verification policy passes.

Protocol fee is paid from escrow.

## 4. EXECUTION RECEIPTS

Every completed workload produces:

ExecutionReceiptV1.

The receipt contains commitments to:

job

input

output

image

machine

worker

telemetry

timestamps

exit code.

## 5. VERIFICATION MARKET

Separate:

PROVIDER

from

VERIFIER.

Verifier can inspect evidence.

Higher-assurance jobs may require independent verification.

Future:

multiple verifiers

TEE attestations

redundant execution

challenge execution

zk proofs.

## 6. MACHINE REPUTATION

Reputation belongs to:

provider

and

machine.

A provider with 100 GPUs should not gain perfect reputation on GPU #101 automatically.

## 7. SPENDING POLICIES FOR AI AGENTS

Agent wallet policies:

daily max spend

job max spend

GPU class allowlist

registry allowlist

runtime max

verification minimum

provider reputation minimum.

This creates:

AWS IAM FOR AUTONOMOUS COMPUTE BUYING.

# ============================================================

# PART 4 — SYSTEM ARCHITECTURE

# ============================================================

Build:

vericompute/
│
├── apps/
│   ├── web/
│   ├── api/
│   ├── scheduler/
│   ├── indexer/
│   ├── verifier/
│   └── gateway/
│
├── agents/
│   └── provider-node/
│
├── programs/
│   └── compute-market/
│
├── packages/
│   ├── sdk/
│   ├── solana/
│   ├── types/
│   ├── job-spec/
│   ├── receipts/
│   ├── verification/
│   ├── pricing/
│   ├── policy/
│   ├── config/
│   └── ui/
│
├── executors/
│   ├── mock/
│   ├── docker/
│   ├── containerd/
│   ├── ray/
│   └── vllm/
│
├── infra/
│   ├── compose/
│   ├── kubernetes/
│   ├── monitoring/
│   └── scripts/
│
├── research/
│   └── upstream/
│
├── docs/
│
├── Cargo.toml
├── Anchor.toml
├── pnpm-workspace.yaml
├── package.json
├── compose.yaml
└── README.md

# ============================================================

# PART 5 — OPEN SOURCE RESEARCH WORKFLOW

# ============================================================

Before coding:

create:

research/upstream/

Clone or inspect the current repositories.

Do NOT commit huge upstream repositories into our own repository.

Instead create:

docs/OPEN_SOURCE_RESEARCH.md

For every source document:

Repository

Current commit SHA

License

Relevant directories

Patterns studied

Code reused

Code rewritten

Reason for reuse

Security concerns.

Example:

NOSANA

Studied:
programs/jobs

Borrowed concept:
market/job/run separation

Not copied:
token economics

Modified:
job states extended for verification/disputes.

AKASH

Studied:
bidengine
cluster
event

Borrowed concept:
provider bid engine

Reimplemented:
Solana-compatible reverse auction.

PRIME

Studied:
worker
validator
orchestrator

Borrowed:
validator separation
challenge concept

No runtime dependency:
repository archived.

BACALHAU

Studied:
executor interfaces
storage adapters
orchestrator/compute separation

Borrowed:
plugin abstraction.

# ============================================================

# PART 6 — LICENSE SAFETY

# ============================================================

Automatically inspect all licenses.

Create:

scripts/license-audit.ts

Generate:

THIRD_PARTY_NOTICES.md

Classify:

GREEN:

MIT
Apache-2.0
BSD-2
BSD-3
ISC

YELLOW:

MPL
LGPL

REVIEW:

GPL
AGPL
SSPL
source-available
unknown.

Do not copy REVIEW code without explicit decision.

Architecture and conceptual learning is permitted.

Do not remove copyright notices.

# ============================================================

# PART 7 — SOLANA PROGRAM

# ============================================================

Implement:

programs/compute-market

Rust + Anchor.

Core accounts:

ProtocolConfig

Provider

WorkerAuthorization

Machine

Offer

Job

Bid

Assignment

Escrow

ReceiptCommitment

Verification

Dispute

AgentPolicy.

# ============================================================

# PROVIDER

# ============================================================

Provider:

authority

provider_id

metadata_hash

stake

status

reputation summary

jobs_completed

jobs_failed

jobs_disputed

created_at.

# ============================================================

# WORKER AUTHORIZATION

# ============================================================

Provider main wallet MUST NOT run on compute worker.

Provider authorizes:

WorkerAuthority.

Worker can:

heartbeat

accept jobs

start jobs

submit receipt commitments.

Worker cannot:

withdraw provider funds

change provider authority

withdraw stake

change treasury.

Support:

authorize_worker

rotate_worker

revoke_worker.

# ============================================================

# MACHINE

# ============================================================

Machine:

provider

worker

machine_id

hardware_claim_hash

benchmark_hash

verification_level

active_offer_count

status.

Off-chain metadata:

GPU model

GPU UUID

VRAM

GPU count

CPU

RAM

storage

bandwidth

region

CUDA

driver

runtime.

# ============================================================

# OFFER

# ============================================================

Offer:

machine

price_per_second

minimum_seconds

maximum_seconds

resource profile hash

verification capabilities

availability

expiration.

# ============================================================

# COMPUTE JOB

# ============================================================

Job:

buyer

job_spec_hash

payment_mint

escrow_amount

max_price

deadline

timeout

verification_policy

state

provider

machine

created_at.

# ============================================================

# BID

# ============================================================

Bid:

job

provider

machine

price

estimated_start

expiration.

# ============================================================

# AGENT POLICY

# ============================================================

AgentPolicy:

owner wallet

agent authority

daily_spend_limit

single_job_limit

allowed_payment_mints

allowed_gpu_classes_hash

required_verification

allowed_registry_hash

expiration

daily_spent.

This lets one wallet delegate bounded compute purchasing authority.

# ============================================================

# PART 8 — JOB STATE MACHINE

# ============================================================

CREATED

↓

FUNDED

↓

OPEN

↓

MATCHED

↓

ASSIGNED

↓

STARTING

↓

RUNNING

↓

RESULT_SUBMITTED

↓

VERIFYING

↓

COMPLETED

Possible terminal branches:

CANCELLED

EXPIRED

FAILED

DISPUTED

REFUNDED.

Every state transition must be explicitly validated.

No arbitrary enum mutation.

# ============================================================

# PART 9 — SOLANA INSTRUCTIONS

# ============================================================

Implement:

initialize_protocol

update_protocol

pause_protocol

register_provider

update_provider

authorize_worker

revoke_worker

register_machine

update_machine

deactivate_machine

create_offer

update_offer

pause_offer

close_offer

create_job

fund_job

open_job

place_bid

cancel_bid

accept_bid

assign_offer

start_job

submit_receipt

submit_verification

complete_job

fail_job

cancel_job

expire_job

open_dispute

resolve_dispute

refund_job

settle_job

create_agent_policy

update_agent_policy

revoke_agent_policy.

# ============================================================

# PART 10 — PDA ARCHITECTURE

# ============================================================

Research Nosana's PDA/account patterns first.

Proposed seeds:

config:
["config"]

provider:
["provider", authority]

worker:
["worker", provider, worker_pubkey]

machine:
["machine", provider, machine_id]

offer:
["offer", provider, offer_id]

job:
["job", buyer, job_id]

bid:
["bid", job, provider]

assignment:
["assignment", job]

escrow:
["escrow", job]

receipt:
["receipt", job]

verification:
["verification", job, verifier]

dispute:
["dispute", job]

agent:
["agent-policy", owner, agent].

Check:

seed sizes

canonical bumps

account substitution risks

collision possibility

upgrade strategy.

# ============================================================

# PART 11 — USDC ESCROW

# ============================================================

Default payment:

USDC.

Do not invent a token.

Implement generic approved SPL-mint support.

Flow:

Buyer
↓
USDC
↓
Job Escrow PDA
↓
verification succeeds
↓
provider + treasury.

Accounting invariant:

# deposit

provider_payment
+
protocol_fee
+
buyer_refund.

Never allow mismatch.

Never let backend custody funds.

# ============================================================

# PART 12 — COMPUTE JOB SPEC

# ============================================================

Create:

ComputeJobSpecV1.

Example:

{
"version": "1",

"runtime": "oci",

"image": {
"repository": "ghcr.io/project/inference",
"digest": "sha256:..."
},

"command": [
"python",
"run.py"
],

"resources": {
"gpu": {
"count": 1,
"minimumVramMb": 24576,
"allowedModels": [
"RTX4090",
"A100",
"H100"
]
},

```
"cpuCores": 4,

"ramMb": 16384,

"storageMb": 20000
```

},

"execution": {
"timeoutSeconds": 600,
"maxStartDelaySeconds": 30
},

"network": {
"mode": "deny-by-default",
"allow": []
},

"verification": {
"policy": "STANDARD"
}
}

Canonicalize.

Hash:

SHA-256 or another explicitly standardized hash.

Store:

job_spec_hash

on-chain.

Never store giant job specs on Solana.

# ============================================================

# PART 13 — PROVIDER NODE

# ============================================================

Prefer Rust or Go.

Study:

Nosana node

Akash provider

Prime worker

Bacalhau compute node.

Provider daemon:

compute-node init

compute-node benchmark

compute-node register

compute-node offer create

compute-node offer update

compute-node start

compute-node status

compute-node jobs

compute-node earnings.

Modules:

identity

Solana client

market listener

bid engine

scheduler adapter

hardware detector

GPU benchmarker

executor

policy engine

telemetry collector

receipt generator

storage client

recovery journal.

# ============================================================

# PART 14 — HARDWARE DETECTION

# ============================================================

Use:

nvidia-smi

NVML where useful

NVIDIA DCGM.

Collect:

GPU model

GPU UUID

VRAM

driver

CUDA capability

GPU count

CPU

RAM

disk

network.

Generate:

HardwareReportV1.

Hash it.

Store report off-chain.

Commit hash on-chain.

# ============================================================

# PART 15 — HARDWARE TRUST

# ============================================================

Never display:

“Verified H100”

merely because provider submitted:

gpu="H100".

Use levels:

CLAIMED

BENCHMARKED

CHALLENGE_VERIFIED

ATTESTED.

MVP:

CLAIMED
+
BENCHMARKED.

Challenge verification becomes next step.

# ============================================================

# PART 16 — BENCHMARKING

# ============================================================

Create standardized benchmark containers.

Example:

CUDA detection

memory test

matrix multiply

GPU throughput

VRAM

CPU

disk

network.

Benchmark report:

machine_id

GPU UUID

driver

benchmark image digest

results

timestamp

nonce

worker signature.

# ============================================================

# PART 17 — BID ENGINE

# ============================================================

Adapt concepts from Akash bidengine.

Provider receives open intents.

Check:

hardware compatibility

available capacity

current utilization

job timeout

region

verification

buyer budget.

Calculate quote:

base_compute_cost

utilization premium

queue premium

verification overhead.

Example:

price =
baseRate
*
duration
*
loadFactor.

Provider signs:

BidV1.

# ============================================================

# PART 18 — SCHEDULER

# ============================================================

Hard filtering first.

Filter by:

GPU count

VRAM

GPU model

runtime

region

price

verification

availability

deadline

provider status.

Then score candidates.

score =
price_weight
+
reputation_weight
+
latency_weight
+
benchmark_weight
+
availability_weight
+
reliability_weight.

Make policy configurable.

Do not make one scheduler permanently privileged by protocol design.

Long-term:

multiple competing schedulers.

# ============================================================

# PART 19 — EXECUTION ENGINE

# ============================================================

Define:

interface ExecutionBackend {
prepare(...)
start(...)
logs(...)
status(...)
stop(...)
collectResult(...)
cleanup(...)
}

Implement:

MockBackend

DockerBackend.

Later:

ContainerdBackend

RayBackend

vLLMBackend.

# ============================================================

# PART 20 — NVIDIA GPU EXECUTION

# ============================================================

Integrate NVIDIA Container Toolkit.

Do not reinvent GPU container mounting.

Validate:

GPU resource isolation

CUDA visibility

selected GPU UUIDs

VRAM requirements

driver compatibility.

# ============================================================

# PART 21 — SANDBOX SECURITY

# ============================================================

Assume every buyer container is hostile.

Initial:

non-root

read-only rootfs where possible

seccomp

cap-drop ALL

resource limits

PID limit

memory limits

CPU limit

GPU selection

no host network

no host PID

no host IPC

no privileged mode

no host filesystem

no Docker socket

no arbitrary devices

network deny-by-default

time limit

output size limit.

Use OPA policy.

Example logical policy:

deny if privileged

deny if hostNetwork

deny if hostPid

deny if dockerSocketMounted

deny if image digest missing

deny if unknown registry

deny if requested device outside assigned GPU.

Future:

gVisor

Kata

Firecracker.

# ============================================================

# PART 22 — IMAGE SECURITY

# ============================================================

Never execute mutable tags such as:

latest.

Resolve:

image:tag

to immutable:

image@sha256:digest.

Commit the digest in job spec.

Execution receipt records the actual digest.

# ============================================================

# PART 23 — EXECUTION RECEIPT

# ============================================================

Create:

ExecutionReceiptV1.

Fields:

version

job_id

job_spec_hash

provider

machine_id

worker

image_digest

input_root

output_root

start_timestamp

finish_timestamp

exit_code

GPU UUID commitment

hardware_report_hash

telemetry_hash

stdout_hash

stderr_hash

result_hash

nonce.

Canonicalize.

Worker signs receipt.

Store full receipt off-chain.

Commit receipt hash on Solana.

# ============================================================

# PART 24 — VERIFICATION

# ============================================================

This is the product moat.

Implement explicit assurance levels.

VERIFY_0:

provider signed.

VERIFY_1:

worker signature
+
assignment validation
+
image digest
+
telemetry consistency
+
input/output commitments
+
timing validation.

VERIFY_2:

challenge-verified.

VERIFY_3:

redundant execution.

VERIFY_4:

TEE/hardware attestation.

VERIFY_5:

cryptographic proof.

Do NOT claim cryptographic verification at levels 0–3.

# ============================================================

# PART 25 — CHALLENGE VERIFICATION

# ============================================================

Study Prime's validator/challenge architecture.

Implement future:

Verifier sends hidden benchmark/challenge.

Provider does not know expected result beforehand.

Check:

claimed hardware

latency

execution

result.

Use random challenges to detect:

fake machines

fabricated work

misreported GPU capability.

# ============================================================

# PART 26 — REDUNDANT EXECUTION

# ============================================================

For deterministic workloads:

send same job to two independent providers.

Compute:

result_hash_A

result_hash_B.

If equal:

verification passes.

If different:

dispatch provider C

or

move to DISPUTED.

Do not use this automatically for expensive workloads unless buyer selects it.

# ============================================================

# PART 27 — AI NON-DETERMINISM

# ============================================================

LLM inference may be non-deterministic.

Verification should optionally include:

model hash

temperature

seed

runtime version

input commitment

output commitment

execution trace

TEE attestation.

Do not assume identical strings imply all AI compute verification.

# ============================================================

# PART 28 — STORAGE

# ============================================================

Define:

ObjectStorage.

Methods:

putInput

getInput

putResult

getResult

putReceipt

getReceipt

createSignedDownload.

Implement:

LocalStorageBackend

S3CompatibleBackend.

Do not tie protocol to MinIO.

Sensitive data:

encrypt client-side where possible.

Solana stores only:

hashes

commitments

URIs when non-sensitive.

# ============================================================

# PART 29 — PRIVACY

# ============================================================

Never put:

prompt

dataset

model weights

API key

environment secrets

result data

on-chain.

Provider may see plaintext during ordinary GPU execution.

Do NOT claim workload confidentiality unless using:

TEE

confidential VM

or equivalent.

Future:

confidential compute tier.

# ============================================================

# PART 30 — INDEXER

# ============================================================

Follow the strongest ideas from Nosana Indexer.

Modes:

live

backfill

reconcile.

LIVE:

subscribe to Solana program events/accounts.

BACKFILL:

scan signatures.

RECONCILE:

periodically fetch authoritative account state.

Database:

PostgreSQL.

Tables:

providers

workers

machines

offers

jobs

bids

assignments

receipts

verifications

disputes

settlements

chain_events

benchmark_reports

machine_metrics

heartbeats

agent_policies

market_price_history.

Every index operation must be idempotent.

# ============================================================

# PART 31 — HEARTBEATS

# ============================================================

Do NOT write every heartbeat to Solana.

Worker signs:

HeartbeatV1.

Fields:

machine

timestamp

available_gpu_count

load

running_jobs

benchmark_hash

nonce.

Scheduler validates signatures.

Use Valkey for short-lived online state.

Periodically checkpoint relevant reputation metrics if required.

# ============================================================

# PART 32 — API

# ============================================================

Build Fastify TypeScript API.

Endpoints:

GET /v1/markets

GET /v1/offers

GET /v1/providers

GET /v1/providers/:provider

GET /v1/machines/:machine

GET /v1/prices

POST /v1/quotes

POST /v1/jobs

GET /v1/jobs/:job

POST /v1/jobs/:job/cancel

GET /v1/jobs/:job/logs

GET /v1/jobs/:job/result

GET /v1/jobs/:job/receipt

GET /v1/jobs/:job/verifications

GET /v1/network/stats.

Provider:

POST /v1/provider/heartbeat

GET /v1/provider/intents

POST /v1/provider/bids

POST /v1/provider/jobs/:job/start

POST /v1/provider/jobs/:job/result.

# ============================================================

# PART 33 — SDK

# ============================================================

Create:

@vericompute/sdk

Developer experience:

const compute = new ComputeClient({
network: "devnet"
});

const quote = await compute.quote({
gpu: {
model: "RTX4090",
count: 1
},
durationSeconds: 300
});

const job = await compute.run({
image:
"ghcr.io/demo/inference@sha256:...",
command: [
"python",
"main.py"
],
resources: {
gpu: {
count: 1,
minimumVramGb: 24
}
},
maxSpendUsd: 0.10,
verification: "STANDARD"
});

console.log(await job.result());

Expose:

findCompute

quote

createJob

fundJob

acceptBid

cancelJob

wait

logs

result

receipt

verifyReceipt.

# ============================================================

# PART 34 — AI AGENT SDK

# ============================================================

Build:

compute.run()

so AI agents do not need blockchain knowledge.

Agent example:

const result = await compute.run({
workload: "...",
maxSpendUsd: 0.25
});

Agent wallet receives bounded authority.

Policy checks occur BEFORE transaction construction.

# ============================================================

# PART 35 — MCP SERVER

# ============================================================

Create MCP tools:

compute_search

compute_quote

compute_run

compute_status

compute_logs

compute_cancel

compute_result

compute_verify

compute_market_price.

Example:

AI:

“Find me the cheapest >=24GB NVIDIA GPU that can start within 60 seconds.”

Tool finds supply.

AI:

“Run this workload, maximum spend $0.20.”

Policy validates.

Job gets created.

# ============================================================

# PART 36 — VLLM MARKET

# ============================================================

Create a specialized template:

LLM Inference.

User chooses:

model

GPU

context

replicas.

Worker launches vLLM.

Expose endpoint.

Long-running deployment payments can later use streamed/metered settlement.

MVP can start with fixed-duration deployment escrow.

# ============================================================

# PART 37 — PRICING DATA

# ============================================================

Track:

GPU

price/hour

region

provider

availability

queue

timestamp.

Calculate:

best

median

p25

p75

24h volume

utilization.

Eventually create:

SOLANA COMPUTE PRICE INDEX.

Example concept:

H100-SOL-SPOT

A100-SOL-SPOT

4090-SOL-SPOT.

This can become useful infrastructure independently of job execution.

# ============================================================

# PART 38 — REPUTATION

# ============================================================

Provider reputation components:

successful jobs

failed jobs

startup SLA

completion SLA

disputes

challenge results

benchmark stability

uptime

receipt validity.

Machine reputation separately:

machine jobs

machine failures

benchmark variance

GPU identity consistency.

Use time decay.

Recent reliability matters more.

# ============================================================

# PART 39 — ANTI-SYBIL

# ============================================================

Do not rely on:

wallet age.

Possible protections:

provider stake

machine identity

benchmark history

successful paid work

challenge performance.

MVP:

small provider collateral

*

performance reputation.

# ============================================================

# PART 40 — PROVIDER STAKE

# ============================================================

Support:

stake

request unstake

cooldown

withdraw.

Stake may be used for:

fraud

repeated SLA violations

challenge fraud.

Do NOT give scheduler unilateral slashing authority.

MVP disputes should be carefully governed.

# ============================================================

# PART 41 — DISPUTES

# ============================================================

Buyer can challenge result during dispute period.

Lock funds.

Store:

reason

evidence commitment

receipt commitment

timestamp.

Resolver may:

pay provider

refund buyer

partial settlement

slash provider.

Long-term:

multi-verifier arbitration.

# ============================================================

# PART 42 — FRONTEND

# ============================================================

Next.js.

Pages:

/

/market

/jobs

/jobs/new

/jobs/[id]

/providers

/providers/[id]

/machines/[id]

/host

/host/setup

/dashboard/buyer

/dashboard/provider

/network

/prices

/explorer

/docs.

Landing:

COMPUTE
AS A MARKET.

Subtitle:

Buy GPU compute from an open network.
Programmatic procurement.
USDC settlement.
Execution evidence.

Buttons:

BUY COMPUTE

PROVIDE COMPUTE.

# ============================================================

# PART 43 — MARKET UI

# ============================================================

Display:

GPU

VRAM

provider

region

price/hour

available

verified level

benchmark

reputation

queue

estimated start.

Filters:

GPU

VRAM

price

region

verification

reputation.

# ============================================================

# PART 44 — ORDER BOOK VIEW

# ============================================================

Show:

COMPUTE DEMAND

versus

COMPUTE SUPPLY.

Example:

BUY

1 × H100

80 GB

10 minutes

Max $0.40

SELL

1 × H100

80 GB

$1.95/hour

available now.

This creates a real market feel instead of ordinary cloud cards.

# ============================================================

# PART 45 — PROVIDER DASHBOARD

# ============================================================

Show:

machines

GPU utilization

online state

running jobs

queue

offers

bid success

revenue

24h revenue

weekly revenue

benchmark

reputation

stake.

Controls:

online/offline

pricing

pause offers

machine registration

worker rotation.

# ============================================================

# PART 46 — JOB PAGE

# ============================================================

Timeline:

Created ✓

Escrowed ✓

Market opened ✓

Bids received ✓

Provider assigned ✓

Started ✓

Execution complete ✓

Receipt committed ✓

Verification passed ✓

USDC settled ✓.

Show:

job spec hash

image digest

provider

machine

GPU

receipt hash

result hash

verification result

Solana signatures.

# ============================================================

# PART 47 — SECURITY REVIEW

# ============================================================

Audit Solana for:

missing signer

PDA substitution

wrong seeds

wrong owner

wrong mint

token program substitution

reinitialization

arbitrary CPI

double refund

double settlement

receipt replay

fake worker

fake provider

invalid state transition

expired bid

bid substitution

verifier impersonation

treasury substitution

fee overflow

timestamp misuse

agent spending-limit bypass

daily limit race

duplicate account aliasing.

# ============================================================

# PART 48 — HOST SECURITY

# ============================================================

Threats:

container escape

cryptomining beyond purchased resource

host scanning

credential theft

Docker socket attack

kernel exploit

network abuse

disk exhaustion

fork bomb

GPU denial-of-service.

Document mitigation.

# ============================================================

# PART 49 — BUYER SECURITY

# ============================================================

Threats:

provider steals inputs

provider fabricates result

provider uses wrong GPU

provider delays job

provider replays output

provider executes modified image

provider hides failure.

Mitigate with:

image digest

receipts

hardware reports

telemetry

challenge verification

redundancy

future TEE.

# ============================================================

# PART 50 — OBSERVABILITY

# ============================================================

Use OpenTelemetry.

Every request includes:

trace_id

request_id

job_id

provider_id

machine_id

tx_signature.

Metrics:

jobs_created

jobs_matched

jobs_started

jobs_completed

jobs_failed

time_to_match

time_to_start

execution_duration

verification_duration

settlement_duration

online_workers

GPU utilization

bid count

bid spread

average price.

# ============================================================

# PART 51 — LOCAL DEVELOPMENT

# ============================================================

Use:

Solana local validator

PostgreSQL

Valkey

local object storage

mock workers.

One command:

docker compose up -d

Then:

anchor build

anchor test

pnpm dev.

# ============================================================

# PART 52 — MOCK NETWORK

# ============================================================

Create three simulated providers:

Provider A:

RTX 4090
24 GB

Provider B:

A100
80 GB

Provider C:

H100
80 GB.

Mock provider daemon must perform full protocol flow.

Only compute execution may be mocked.

Never mock:

escrow

state machine

bids

settlement.

# ============================================================

# PART 53 — REAL GPU DEMO

# ============================================================

Then enable:

EXECUTOR=docker.

Run CUDA smoke test.

Example:

nvidia-smi

then CUDA workload.

Then:

vLLM or small inference job.

# ============================================================

# PART 54 — END-TO-END DEMO

# ============================================================

Buyer:

“I need >=24GB VRAM for 5 minutes, maximum $0.10.”

System:

creates compute intent

escrows USDC

opens market.

Providers:

4090:
$0.035

A100:
$0.071

H100:
$0.094.

Scheduler selects according to:

price
+
reputation
+
startup time.

Worker executes.

Receipt generated.

Verifier checks.

Program settles.

Buyer receives result.

Provider receives USDC.

# ============================================================

# PART 55 — TESTING

# ============================================================

On-chain unit/integration tests:

provider registration

worker delegation

worker revocation

machine registration

offers

job creation

escrow

bids

assignment

start

receipt

verification

settlement

refund

dispute

agent policy.

Attack tests:

unauthorized worker

wrong mint

wrong escrow

wrong provider

fake receipt

replay

double settlement

double refund

expired job

excessive fee

agent overspend.

# ============================================================

# PART 56 — INVARIANTS

# ============================================================

Always enforce:

settledAmount
+
refundAmount
============

escrowDeposit.

A terminal job never re-enters RUNNING.

COMPLETED cannot be settled twice.

REFUNDED cannot settle.

Receipt belongs to assigned job.

Receipt worker belongs to assigned provider.

Payment mint equals job payment mint.

Fee <= protocol max fee.

Agent cannot exceed:

per-job limit

daily limit.

# ============================================================

# PART 57 — CHAOS TESTING

# ============================================================

Simulate:

worker crash

scheduler crash

API crash

indexer outage

RPC outage

DB outage

Valkey outage

transaction expiration

Solana fork/reorg-like commitment changes

duplicate WebSocket notifications

missing notification

duplicate receipt

provider disconnect.

System must recover.

# ============================================================

# PART 58 — INDEXER RECOVERY

# ============================================================

Copy the architectural lesson from Nosana's current indexer:

WebSocket = low latency.

Account reconciliation = state correctness.

Signature history = missed-event recovery.

Never treat one of them as sufficient.

# ============================================================

# PART 59 — MVP

# ============================================================

MVP must contain only:

Solana program

USDC-compatible escrow

provider registration

worker delegation

machine registration

market offers

compute intent

provider bidding

scheduler

Docker executor

GPU detection

receipt

STANDARD verification

settlement

reputation

indexer

SDK

buyer UI

provider UI.

Do NOT delay MVP for:

zkML

full TEE

DAO

native token

distributed training

capacity derivatives

advanced P2P.

# ============================================================

# PART 60 — V2

# ============================================================

After MVP:

challenge verification

redundant jobs

agent policies

vLLM persistent endpoints

spot market analytics

gVisor isolation

multi-scheduler architecture.

# ============================================================

# PART 61 — V3

# ============================================================

Later:

TEE execution

confidential GPU

distributed Ray jobs

multi-GPU clusters

distributed training

cryptographic compute proofs

permissionless verifier market.

# ============================================================

# PART 62 — LONG-TERM VISION

# ============================================================

Agent A makes money.

Agent A determines:

“I need one H100 for 12 minutes.”

Agent A calls marketplace.

Providers compete.

Agent A purchases compute using delegated USDC budget.

Provider Agent executes workload.

Verifier evaluates evidence.

Solana settles.

No centralized cloud billing relationship required.

That is the long-term product.

# ============================================================

# PART 63 — BUSINESS MODEL

# ============================================================

Initial revenue:

1–3% settlement fee.

Later:

priority scheduling

enterprise private pools

verified-compute premium

confidential-compute premium

API infrastructure

reserved capacity.

Do NOT introduce token-based inflation as primary revenue.

# ============================================================

# PART 64 — PRODUCT MOATS

# ============================================================

Do not assume blockchain itself is moat.

Potential moats:

liquid provider supply

compute price history

provider performance history

machine reputation

verification network

agent procurement SDK

standard ComputeIntent format

standard ExecutionReceipt format

developer integrations.

# ============================================================

# PART 65 — DOCUMENTATION

# ============================================================

Generate:

README.md

ARCHITECTURE.md

PROTOCOL.md

MARKET_DESIGN.md

COMPUTE_INTENT.md

JOB_SPEC.md

EXECUTION_RECEIPT.md

VERIFICATION.md

PROVIDER_NODE.md

INDEXER.md

SDK.md

MCP.md

AGENT_POLICIES.md

SECURITY.md

THREAT_MODEL.md

OPEN_SOURCE_RESEARCH.md

THIRD_PARTY_NOTICES.md

DEPLOYMENT.md

LOCAL_DEVELOPMENT.md.

# ============================================================

# PART 66 — IMPLEMENTATION SEQUENCE

# ============================================================

PHASE 0

Clone/research upstream projects.

PHASE 1

Write OPEN_SOURCE_RESEARCH.md.

PHASE 2

Protocol/account design.

PHASE 3

State machine.

PHASE 4

Escrow.

PHASE 5

Program tests.

PHASE 6

Indexer.

PHASE 7

Provider registration.

PHASE 8

Machine benchmark.

PHASE 9

Provider daemon.

PHASE 10

Compute intent.

PHASE 11

Bid engine.

PHASE 12

Scheduler.

PHASE 13

Mock execution.

PHASE 14

Docker execution.

PHASE 15

ExecutionReceiptV1.

PHASE 16

Verification service.

PHASE 17

Settlement.

PHASE 18

SDK.

PHASE 19

MCP.

PHASE 20

Frontend.

PHASE 21

GPU demo.

PHASE 22

security tests.

PHASE 23

Devnet.

# ============================================================

# PART 67 — FIRST RESPONSE REQUIREMENT

# ============================================================

Before generating the full application, your FIRST response must contain:

1. Research matrix comparing:

Nosana

Akash

Prime Intellect

Bacalhau

Ray

io.net public sources.

2. For every project:

what exists

what we should reuse

what we should rewrite

license

security concern

maintenance status.

3. A feature-gap matrix:

Nosana vs Akash vs Prime vs our system.

4. Identify which features would merely copy competitors.

5. Identify our actual differentiated features.

6. Draw full architecture.

7. Draw job lifecycle.

8. Draw settlement lifecycle.

9. Draw worker lifecycle.

10. Define all Solana accounts.

11. Define every instruction.

12. Define ComputeJobSpecV1.

13. Define ExecutionReceiptV1.

14. Define BidV1.

15. Define HeartbeatV1.

16. Define HardwareReportV1.

17. Define verification trust model.

18. Define license/reuse strategy.

19. Identify top 20 security threats.

20. Produce the final repository structure.

Only after that:

begin PHASE 0 and PHASE 1.

# ============================================================

# PART 68 — IMPORTANT ENGINEERING RULE

# ============================================================

Never produce code like:

TODO implement scheduler

TODO blockchain integration

mockPayment()

fakeVerification()

return randomProvider().

Mocks are permitted only under explicit:

MOCK_EXECUTOR=true

development mode.

Protocol logic must be real.

# ============================================================

# PART 69 — DEFINITION OF DONE

# ============================================================

We are NOT done when:

wallet connects

market cards render

fake GPUs appear

Docker starts

Solana transaction succeeds.

We are done when:

REAL PROVIDER REGISTRATION
+
REAL MACHINE REGISTRATION
+
REAL COMPUTE INTENT
+
REAL QUOTES
+
REAL MATCHING
+
REAL USDC ESCROW
+
REAL CONTAINER EXECUTION
+
REAL EXECUTION RECEIPT
+
REAL VERIFICATION
+
REAL SETTLEMENT
+
REAL INDEXING

work together.

# FINAL PRODUCT

Do not build another decentralized GPU directory.

Build:

A SOLANA-NATIVE COMPUTE EXCHANGE

where compute behaves like a programmable financial market:

demand expresses intent

supply competes

execution produces evidence

verification establishes confidence

Solana settles value.

The simplest product description should eventually be:

“Stripe + a spot exchange for compute, settled on Solana.”

And the developer experience should approach:

await compute.run({
gpu: "H100",
maxSpend: 0.50,
verification: "STANDARD",
workload
});

Research first.

Reuse good open-source engineering.

Rewrite what needs Solana-native semantics.

Respect licenses.

Do not fake decentralization.

Do not fake verification.

Do not invent unavailable company source code.

Build the smallest real network that proves the complete economic and execution loop.
