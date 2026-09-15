#!/usr/bin/env sh
set -eu

test_docker_host="${DOCKER_HOST:-$(docker context inspect --format '{{.Endpoints.docker.Host}}')}"
test_docker_config="$(mktemp -d "${TMPDIR:-/tmp}/vericompute-docker.XXXXXX")"
cleanup() {
  rm -rf "$test_docker_config"
}
trap cleanup EXIT INT TERM
printf '{"auths":{}}' > "$test_docker_config/config.json"
export DOCKER_HOST="$test_docker_host"
export DOCKER_CONFIG="$test_docker_config"
"$@"
