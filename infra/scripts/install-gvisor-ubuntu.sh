#!/usr/bin/env sh
set -eu

if [ "$(uname -s)" != "Linux" ] || ! command -v apt-get >/dev/null 2>&1; then
  echo "This installer requires an Ubuntu/Debian Linux host." >&2
  exit 1
fi

curl -fsSL https://gvisor.dev/archive.key \
  | sudo gpg --dearmor --yes -o /usr/share/keyrings/gvisor-archive-keyring.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/gvisor-archive-keyring.gpg] https://storage.googleapis.com/gvisor/releases release main" \
  | sudo tee /etc/apt/sources.list.d/gvisor.list >/dev/null
sudo apt-get update
sudo apt-get install -y runsc
sudo runsc install
sudo systemctl restart docker
docker info --format '{{json .Runtimes}}' | grep -q '"runsc"'
docker run --rm --runtime=runsc \
  docker.io/library/alpine@sha256:14358309a308569c32bdc37e2e0e9694be33a9d99e68afb0f5ff33cc1f695dce \
  /bin/sh -c \
  'dmesg | grep -q "Starting gVisor"'
echo "gVisor runsc is installed and passed the sandbox smoke test."
