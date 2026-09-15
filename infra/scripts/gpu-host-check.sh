#!/usr/bin/env bash
set -euo pipefail
command -v docker
command -v nvidia-smi
command -v opa
nvidia-smi --query-gpu=name,uuid,memory.total,driver_version --format=csv,noheader
: "${CUDA_IMAGE:?Set CUDA_IMAGE to an immutable repository@sha256:digest}"
[[ "$CUDA_IMAGE" =~ @sha256:[a-f0-9]{64}$ ]] || { echo 'Immutable CUDA image digest required'; exit 1; }
docker run --rm --gpus all --user 65532:65532 --read-only --network none --cap-drop ALL --security-opt no-new-privileges:true --pids-limit 128 --memory 1g --memory-swap 1g --cpus 1 "$CUDA_IMAGE" nvidia-smi
