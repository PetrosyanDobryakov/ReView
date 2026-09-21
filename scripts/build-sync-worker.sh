#!/usr/bin/env bash
# Build the Rust review-sync Durable Object that `wrangler deploy` uploads.
# Wrangler runs this from worker/ via [build].command. It is also safe to run
# from the repo root.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT/worker"

if ! command -v rustup >/dev/null 2>&1; then
  echo "build-sync-worker: rustup is required" >&2
  exit 1
fi
rustup target add wasm32-unknown-unknown

if ! command -v worker-build >/dev/null 2>&1; then
  echo "build-sync-worker: installing worker-build 0.8.6"
  cargo install worker-build --version 0.8.6 --locked
fi

worker-build --release
echo "build-sync-worker: wrote worker/build/index.js + index_bg.wasm (Rust wasm, not src/index.ts)"
