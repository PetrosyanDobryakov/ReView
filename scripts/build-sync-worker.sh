#!/usr/bin/env bash
# Build the Rust review-sync Durable Object that `wrangler deploy` uploads.
# Wrangler runs this from worker/ via [build].command. It is also safe to run
# from the repo root.
#
# Workers Builds (Ubuntu 24.04) ships curl and build-essential, not Rust.
# When rustup is missing, this installs stable (minimal profile) and the
# wasm32-unknown-unknown target into ${CARGO_HOME:-$HOME/.cargo} so
# `bash scripts/deploy.sh all` can run worker-build with no dashboard
# install command.
#
#   bash scripts/build-sync-worker.sh --ensure-rustup
#     Install or reuse the toolchain and wasm target, then exit 0.
#     Does not compile the Durable Object.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT/worker"

ENSURE_ONLY=0
if [[ "${1:-}" == "--ensure-rustup" ]]; then
  ENSURE_ONLY=1
elif [[ -n "${1:-}" ]]; then
  echo "usage: $0 [--ensure-rustup]" >&2
  exit 2
fi

cargo_bin_dir() {
  printf '%s/bin' "${CARGO_HOME:-${HOME:-}/.cargo}"
}

source_cargo_env() {
  local env_file bin
  env_file="${CARGO_HOME:-${HOME:-}/.cargo}/env"
  if [[ -f "$env_file" ]]; then
    # shellcheck disable=SC1090
    source "$env_file"
  fi
  bin="$(cargo_bin_dir)"
  if [[ -d "$bin" ]]; then
    case ":${PATH}:" in
      *":${bin}:"*) ;;
      *) export PATH="${bin}:${PATH}" ;;
    esac
  fi
  hash -r
}

ensure_rustup() {
  source_cargo_env
  if command -v rustup >/dev/null 2>&1; then
    echo "build-sync-worker: using $(command -v rustup)"
    return 0
  fi
  if [[ -z "${HOME:-}" ]]; then
    echo "build-sync-worker: HOME is unset; cannot install rustup" >&2
    exit 1
  fi
  if ! command -v curl >/dev/null 2>&1; then
    echo "build-sync-worker: curl is required to install rustup" >&2
    exit 1
  fi
  echo "build-sync-worker: rustup not found; installing stable (minimal) with wasm32-unknown-unknown"
  curl --proto '=https' --tlsv1.2 -fsSL https://sh.rustup.rs |
    sh -s -- -y --profile minimal --default-toolchain stable --target wasm32-unknown-unknown
  source_cargo_env
  if ! command -v rustup >/dev/null 2>&1; then
    echo "build-sync-worker: rustup install finished but rustup is not on PATH" >&2
    exit 1
  fi
  echo "build-sync-worker: installed $(rustup --version)"
}

ensure_rustup
rustup target add wasm32-unknown-unknown
echo "build-sync-worker: $(rustc --version)"

if [[ "$ENSURE_ONLY" -eq 1 ]]; then
  echo "build-sync-worker: ensure-rustup ok"
  exit 0
fi

# worker-build 0.8.6 -> ureq/native-tls -> openssl-sys. The Builds image
# preinstalls libssl-dev (headers + libssl.so) but the published package list
# does not include pkg-config. Point openssl-sys at those files when
# pkg-config cannot see openssl, and apt-install only if the files are absent.
ensure_openssl_for_worker_build() {
  if command -v pkg-config >/dev/null 2>&1 && pkg-config --exists openssl; then
    echo "build-sync-worker: openssl $(pkg-config --modversion openssl) via pkg-config"
    return 0
  fi

  local inc="" lib="" candidate
  for candidate in /usr/include /usr/local/include; do
    if [[ -f "${candidate}/openssl/ssl.h" ]]; then
      inc="$candidate"
      break
    fi
  done
  for candidate in /usr/lib/x86_64-linux-gnu /usr/lib64 /usr/lib /usr/local/lib; do
    if [[ -e "${candidate}/libssl.so" || -e "${candidate}/libcrypto.so" ]]; then
      lib="$candidate"
      break
    fi
  done
  if [[ -n "$inc" && -n "$lib" ]]; then
    export OPENSSL_NO_PKG_CONFIG=1
    export OPENSSL_INCLUDE_DIR="$inc"
    export OPENSSL_LIB_DIR="$lib"
    echo "build-sync-worker: openssl headers ${inc} libs ${lib} (pkg-config did not see openssl)"
    return 0
  fi

  local apt=()
  if command -v apt-get >/dev/null 2>&1 && [[ "$(id -u)" -eq 0 ]]; then
    apt=(apt-get)
  elif command -v apt-get >/dev/null 2>&1 && command -v sudo >/dev/null 2>&1 && sudo -n true >/dev/null 2>&1; then
    apt=(sudo -n apt-get)
  else
    echo "build-sync-worker: openssl headers not found, and apt-get needs root or passwordless sudo" >&2
    echo "build-sync-worker: install pkg-config and libssl-dev, then rerun" >&2
    exit 1
  fi
  echo "build-sync-worker: installing pkg-config libssl-dev (${apt[*]})"
  DEBIAN_FRONTEND=noninteractive "${apt[@]}" update
  DEBIAN_FRONTEND=noninteractive "${apt[@]}" install -y pkg-config libssl-dev
  if ! pkg-config --exists openssl; then
    echo "build-sync-worker: openssl still not visible to pkg-config after apt install" >&2
    exit 1
  fi
  echo "build-sync-worker: openssl $(pkg-config --modversion openssl) via pkg-config"
}

if ! command -v worker-build >/dev/null 2>&1; then
  ensure_openssl_for_worker_build
  echo "build-sync-worker: installing worker-build 0.8.6"
  cargo install worker-build --version 0.8.6 --locked
fi

worker-build --release
echo "build-sync-worker: wrote worker/build/index.js + index_bg.wasm (Rust wasm, not src/index.ts)"
