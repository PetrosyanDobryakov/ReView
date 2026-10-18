#!/usr/bin/env bash
# Publish to Cloudflare.
#   hub  (default)  Worker **review-hub**: the signaling hub only
#                   (cloudflare/worker.ts, one Durable Object per room). It
#                   introduces peers and stores nothing; boards never touch it.
#   spa             Worker **review**: optional static copy of the web UI.
#   all             both.
#
# Auth (pick one):
#   CI / agents:  CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID
#   Local:        wrangler OAuth (`npx wrangler login`) as fallback
#
# Usage:
#   ./scripts/deploy.sh [hub|spa|all]
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# Each Worker pins its account in its own wrangler.toml (hub: amicus, spa: zpro).
# A CLOUDFLARE_ACCOUNT_ID env var would override that, so it is cleared per
# target below unless HUB_ACCOUNT_ID / SPA_ACCOUNT_ID say otherwise.
HUB_ACCOUNT_ID="${HUB_ACCOUNT_ID:-2f8144b0acc394459de5ca531dcfddf5}"
SPA_ACCOUNT_ID="${SPA_ACCOUNT_ID:-3058d81da41b02e06744d5d058570aab}"

TARGET="${1:-hub}"

case "$TARGET" in
  -h | --help | help)
    sed -n '2,14p' "$0"
    exit 0
    ;;
  all | hub | spa | review) ;;
  *)
    echo "usage: $0 [hub|spa|all]" >&2
    exit 2
    ;;
esac

if [[ -z "${CLOUDFLARE_API_TOKEN:-}" ]]; then
  echo "deploy: CLOUDFLARE_API_TOKEN unset — using wrangler OAuth if present"
else
  echo "deploy: using CLOUDFLARE_API_TOKEN"
fi

command -v npx >/dev/null 2>&1 || {
  echo "deploy: missing command: npx" >&2
  exit 1
}

if [[ ! -d node_modules/typescript ]] || [[ ! -x node_modules/.bin/tsc ]]; then
  echo "deploy: installing root deps"
  npm ci --no-audit --no-fund
fi

if [[ "$TARGET" == "hub" || "$TARGET" == "all" ]]; then
  echo "==> review-hub (signaling hub)"
  CLOUDFLARE_ACCOUNT_ID="$HUB_ACCOUNT_ID" npx wrangler deploy -c cloudflare/wrangler.toml
fi

if [[ "$TARGET" == "spa" || "$TARGET" == "review" || "$TARGET" == "all" ]]; then
  echo "==> review (static web UI)"
  # Root wrangler.toml [build] runs `npm run build` before upload.
  CLOUDFLARE_ACCOUNT_ID="$SPA_ACCOUNT_ID" npx wrangler deploy
fi

echo "deploy: done"
echo "deploy: verify → node scripts/check-live-version.mjs"
