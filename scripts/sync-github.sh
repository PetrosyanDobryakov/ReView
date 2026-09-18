#!/usr/bin/env bash
# Sync Origin tip → GitHub (dev-warexpor + main).
# Day-to-day work stays on Cursor Origin; run this when you want GitHub caught up.
#
# Usage:
#   ./scripts/sync-github.sh           # push tip to github/dev-warexpor and github/main
#   ./scripts/sync-github.sh --dry-run # show what would be pushed
#
# Requires: `github` remote (https://github.com/PetrosyanDobryakov/ReView.git)
# and auth (`gh` / credential helper). Coordinator has this; children usually do not.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

DRY=0
for arg in "$@"; do
  case "$arg" in
    -n | --dry-run) DRY=1 ;;
    -h | --help | help)
      sed -n '2,12p' "$0"
      exit 0
      ;;
    *)
      echo "usage: $0 [--dry-run]" >&2
      exit 2
      ;;
  esac
done

if ! git remote get-url github >/dev/null 2>&1; then
  echo "sync-github: missing remote 'github' — add:" >&2
  echo "  git remote add github https://github.com/PetrosyanDobryakov/ReView.git" >&2
  exit 1
fi

BRANCH="$(git rev-parse --abbrev-ref HEAD)"
TIP="$(git rev-parse HEAD)"
SHORT="$(git rev-parse --short HEAD)"

echo "sync-github: local branch  $BRANCH"
echo "sync-github: tip           $SHORT ($TIP)"
echo "sync-github: github remote $(git remote get-url github)"

if [[ "$DRY" -eq 1 ]]; then
  echo "sync-github: dry-run — would push:"
  echo "  $TIP → github/dev-warexpor"
  echo "  $TIP → github/main"
  git ls-remote --heads github dev-warexpor main 2>/dev/null || true
  exit 0
fi

# Push current tip SHA explicitly so we do not depend on being checked out as those names.
git push github "$TIP:refs/heads/dev-warexpor"
git push github "$TIP:refs/heads/main"

echo "sync-github: done"
echo "sync-github: github/dev-warexpor and github/main → $SHORT"
