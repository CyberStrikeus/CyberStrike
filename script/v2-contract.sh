#!/usr/bin/env bash
# Boots the v2 listener and runs the vendored opencodex contract gate against it. Prompt cases stay opt-in
# (V2_ALLOW_PROMPT=1) because they spend model quota.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export CYBERSTRIKE_SERVER_PASSWORD="${CYBERSTRIKE_SERVER_PASSWORD:-v2-contract-$$}"
PORT="${V2_PORT:-4198}"

cd "$ROOT/packages/cyberstrike"
bun run ./src/index.ts serve --api v2 --api-port "$PORT" &
SERVER=$!
trap 'kill "$SERVER" 2>/dev/null || true' EXIT

for _ in $(seq 1 90); do
  if curl -fs -o /dev/null -u "cyberstrike:$CYBERSTRIKE_SERVER_PASSWORD" "http://127.0.0.1:$PORT/api/info"; then
    break
  fi
  sleep 1
done

V2_BASE="http://127.0.0.1:$PORT" \
V2_USER=cyberstrike \
V2_PASSWORD="$CYBERSTRIKE_SERVER_PASSWORD" \
V2_DIRECTORY="$ROOT/packages/api-v2" \
python3 -I "$ROOT/script/v2-contract-check.py"
