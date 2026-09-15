#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

rpc_url="${SOLANA_RPC_URL:-https://api.devnet.solana.com}"
deployer_keypair="${DEPLOYER_KEYPAIR:-$HOME/.config/solana/id.json}"
program_keypair="${PROGRAM_KEYPAIR:-target/deploy/compute_market-keypair.json}"
program_binary="${PROGRAM_BINARY:-target/deploy/compute_market.so}"

for file in "$deployer_keypair" "$program_keypair" "$program_binary"; do
  if [[ ! -f "$file" ]]; then
    echo "Required file is missing: $file" >&2
    exit 1
  fi
done

program_id="$(solana-keygen pubkey "$program_keypair")"
idl_program_id="$(node -e "const i=require('./target/idl/compute_market.json'); process.stdout.write(i.address)")"
if [[ "$program_id" != "$idl_program_id" ]]; then
  echo "Program keypair $program_id does not match IDL $idl_program_id" >&2
  exit 1
fi
mkdir -p idl
cp target/idl/compute_market.json idl/compute_market.json

program_size="$(wc -c < "$program_binary" | tr -d ' ')"
rent_sol="$(solana rent "$program_size" --url "$rpc_url" | awk '/Rent-exempt minimum:/ {print $3}')"
balance_sol="$(solana balance "$deployer_keypair" --url "$rpc_url" --lamports | awk '{print $1 / 1000000000}')"
python3 - "$rent_sol" "$balance_sol" <<'PY'
import sys
rent, balance = map(float, sys.argv[1:])
required = rent + 0.05
if balance < required:
    raise SystemExit(
        f"Insufficient deployer balance: {balance:.9f} SOL; need at least "
        f"{required:.9f} SOL (rent plus transaction buffer)"
    )
print(f"Preflight passed: {balance:.9f} SOL available; {required:.9f} SOL required")
PY

solana program deploy "$program_binary" \
  --program-id "$program_keypair" \
  --keypair "$deployer_keypair" \
  --url "$rpc_url" \
  --max-len "$program_size" \
  --commitment finalized

export SOLANA_RPC_URL="$rpc_url"
export DEPLOYER_KEYPAIR="$deployer_keypair"
if [[ -z "${TREASURY_PUBKEY:-}" && -f keys/treasury.json ]]; then
  export TREASURY_PUBKEY="$(solana-keygen pubkey keys/treasury.json)"
fi
if [[ -z "${VERIFIER_PUBKEY:-}" && -f keys/verifier.json ]]; then
  export VERIFIER_PUBKEY="$(solana-keygen pubkey keys/verifier.json)"
fi
npx tsx scripts/bootstrap-public-cluster.ts
