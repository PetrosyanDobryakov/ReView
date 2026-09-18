#!/usr/bin/env bash
# Keep GitHub tip branches aligned: push HEAD → dev-warexpor + main.
#
# Usage:
#   ./scripts/sync-github.sh           # push tip to GitHub/dev-warexpor and GitHub/main
#   ./scripts/sync-github.sh --dry-run # show what would be pushed
#
# Remote resolution (first match):
#   1. remote named `github`
#   2. remote named `origin` if it points at github.com/.../ReView
# Requires auth (`gh` / credential helper).
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

resolve_github_remote() {
  if git remote get-url github >/dev/null 2>&1; then
    echo github
    return
  fi
  if git remote get-url origin >/dev/null 2>&1; then
    local url
    url="$(git remote get-url origin)"
    case "$url" in
      *github.com*PetrosyanDobryakov/ReView* | *github.com*/*ReView*)
        echo origin
        return
        ;;
    esac
  fi
  return 1
}

REMOTE="$(resolve_github_remote)" || {
  echo "sync-github: no GitHub remote — add one of:" >&2
  echo "  git remote add github https://github.com/PetrosyanDobryakov/ReView.git" >&2
  echo "  # or point origin at that URL (GitHub-primary setups)" >&2
  exit 1
}

BRANCH="$(git rev-parse --abbrev-ref HEAD)"
TIP="$(git rev-parse HEAD)"
SHORT="$(git rev-parse --short HEAD)"
URL="$(git remote get-url "$REMOTE")"

echo "sync-github: local branch  $BRANCH"
echo "sync-github: tip           $SHORT ($TIP)"
echo "sync-github: remote        $REMOTE ($URL)"

if [[ "$DRY" -eq 1 ]]; then
  echo "sync-github: dry-run — would push:"
  echo "  $TIP → ${REMOTE}/dev-warexpor"
  echo "  $TIP → ${REMOTE}/main"
  git ls-remote --heads "$REMOTE" dev-warexpor main 2>/dev/null || true
  exit 0
fi

# Push current tip SHA explicitly so we do not depend on being checked out as those names.
git push "$REMOTE" "$TIP:refs/heads/dev-warexpor"
git push "$REMOTE" "$TIP:refs/heads/main"

echo "sync-github: done"
echo "sync-github: ${REMOTE}/dev-warexpor and ${REMOTE}/main → $SHORT"
