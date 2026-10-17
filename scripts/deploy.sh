#!/usr/bin/env bash
# Optional: publish a static copy of the web UI to the Cloudflare Worker
# **review** (Assets only). ReView is self-hosted: sync needs a review-host
# hub. A static https copy can only use wss:// hubs (browsers block ws:// from
# https pages), so add one in Settings -> System -> Connection (P2P) -> Friend's hub.
#
# There is no sync worker any more; boards never touch Cloudflare.
#
# Auth (pick one):
#   CI / agents:  CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID
#   Local:        wrangler OAuth (`npx wrangler login`) as fallback
#
# Usage:
#   ./scripts/deploy.sh [spa]
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

export CLOUDFLARE_ACCOUNT_ID="${CLOUDFLARE_ACCOUNT_ID:-3058d81da41b02e06744d5d058570aab}"

TARGET="${1:-spa}"

case "$TARGET" in
  -h | --help | help)
    sed -n '2,16p' "$0"
    exit 0
    ;;
  all | spa | review) ;;
  *)
    echo "usage: $0 [spa]" >&2
    exit 2
    ;;
esac

if [[ -z "${CLOUDFLARE_API_TOKEN:-}" ]]; then
  echo "deploy: CLOUDFLARE_API_TOKEN unset — using wrangler OAuth if present"
else
  echo "deploy: using CLOUDFLARE_API_TOKEN (account ${CLOUDFLARE_ACCOUNT_ID})"
fi

command -v npx >/dev/null 2>&1 || {
  echo "deploy: missing command: npx" >&2
  exit 1
}

if [[ ! -d node_modules/typescript ]] || [[ ! -x node_modules/.bin/tsc ]]; then
  echo "deploy: installing root deps"
  npm ci --no-audit --no-fund
fi

echo "==> review (static web UI)"
# Root wrangler.toml [build] runs `npm run build` before upload.
npx wrangler deploy

echo "deploy: done"
echo "deploy: verify → node scripts/check-live-version.mjs"
