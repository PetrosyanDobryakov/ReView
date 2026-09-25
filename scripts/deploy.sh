#!/usr/bin/env bash
# Deploy ReView Cloudflare Workers from repo tip.
# Always: review-sync (DO) then review (SPA Assets). Idempotent.
#
# Auth (pick one):
#   CI / agents:  CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID
#   Local:        wrangler OAuth (`npx wrangler login`) as fallback
#
# Usage:
#   ./scripts/deploy.sh           # both (default)
#   ./scripts/deploy.sh all
#   ./scripts/deploy.sh spa       # review only
#   ./scripts/deploy.sh sync      # review-sync only
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

export CLOUDFLARE_ACCOUNT_ID="${CLOUDFLARE_ACCOUNT_ID:-3058d81da41b02e06744d5d058570aab}"

TARGET="${1:-all}"

case "$TARGET" in
  -h | --help | help)
    sed -n '2,14p' "$0"
    exit 0
    ;;
  all | spa | review | sync | review-sync) ;;
  *)
    echo "usage: $0 [all|spa|sync]" >&2
    exit 2
    ;;
esac

if [[ -z "${CLOUDFLARE_API_TOKEN:-}" ]]; then
  echo "deploy: CLOUDFLARE_API_TOKEN unset — using wrangler OAuth if present"
else
  echo "deploy: using CLOUDFLARE_API_TOKEN (account ${CLOUDFLARE_ACCOUNT_ID})"
fi

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "deploy: missing command: $1" >&2
    exit 1
  }
}

need_cmd npm
need_cmd npx

ensure_worker_deps() {
  if [[ ! -d worker/node_modules/wrangler ]]; then
    echo "deploy: installing worker deps"
    (cd worker && npm ci --no-audit --no-fund)
  fi
}

ensure_root_deps() {
  if [[ ! -d node_modules/typescript ]] || [[ ! -x node_modules/.bin/tsc ]]; then
    echo "deploy: installing root deps"
    npm ci --no-audit --no-fund
  fi
}

deploy_sync() {
  echo "==> review-sync (Rust Durable Object)"
  ensure_worker_deps
  # wrangler [build] runs scripts/build-sync-worker.sh (worker-build).
  # That script installs rustup + wasm32-unknown-unknown when the image has
  # no Rust (Workers Builds). Uploaded module is worker/build/index.js +
  # index_bg.wasm, not worker/src/index.ts.
  (cd worker && npx wrangler deploy)
}

deploy_spa() {
  echo "==> review (SPA Assets)"
  ensure_root_deps
  # Root wrangler.toml [build] runs `npm run build` before upload.
  npx wrangler deploy
}

case "$TARGET" in
  all)
    deploy_sync
    deploy_spa
    ;;
  spa | review)
    deploy_spa
    ;;
  sync | review-sync)
    deploy_sync
    ;;
esac

echo "deploy: done ($TARGET)"
echo "deploy: verify SPA  → node scripts/check-live-version.mjs"
echo "deploy: verify sync → curl -sS https://review-sync.zpro-driftman.workers.dev/health"
