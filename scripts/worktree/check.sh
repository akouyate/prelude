#!/bin/sh
set -eu

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

if [ ! -f .env.keys ]; then
  printf 'Missing .env.keys. Run `make init`.\n' >&2
  exit 1
fi
if [ ! -f .env.worktree ]; then
  printf 'Missing .env.worktree. Run `make init`.\n' >&2
  exit 1
fi

permissions="$(stat -f '%Lp' .env.worktree 2>/dev/null || stat -c '%a' .env.worktree 2>/dev/null || true)"
if [ "$permissions" != "600" ]; then
  printf '.env.worktree must have mode 600 (found %s).\n' "${permissions:-unknown}" >&2
  exit 1
fi

shared_probe="$(dotenvx get REALTIME_API_KEY -f .env 2>/dev/null || true)"
case "$shared_probe" in
  ""|encrypted:*)
    printf '.env.keys cannot decrypt the repository .env.\n' >&2
    exit 1
    ;;
esac
unset shared_probe

if ! ./scripts/run-with-env.sh sh -ec '
  test "${#MARKETING_DEMO_SERVICE_SECRET}" -ge 32
  test "${#REALTIME_API_KEY}" -ge 32
  decoded_bytes="$(printf %s "$MARKETING_DEMO_HANDOFF_ENCRYPTION_KEY" | base64 -d 2>/dev/null | wc -c | tr -d " ")"
  test "$decoded_bytes" = 32
  test -n "$MARKETING_DEMO_LOCAL_RETURN_TARGET"
' >/dev/null 2>&1; then
  printf 'Generated worktree secrets are missing or invalid. Rerun `make init`.\n' >&2
  exit 1
fi

printf 'Worktree environment is valid.\n'
