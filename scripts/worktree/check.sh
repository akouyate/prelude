#!/bin/sh
set -eu

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

. "$repo_root/scripts/worktree/lib.sh"

if [ ! -f .env.keys ]; then
  printf 'Missing .env.keys. Run `make init`.\n' >&2
  exit 1
fi
if [ ! -f .env.worktree ]; then
  printf 'Missing .env.worktree. Run `make init`.\n' >&2
  exit 1
fi

worktree_id="$(persisted_worktree_id .env.worktree 2>/dev/null || true)"
validate_worktree_id "$worktree_id"
assert_no_registered_worktree_collision "$repo_root" "$worktree_id"
assert_compose_ports_available "$worktree_id"
load_worktree_values "$worktree_id"

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
  test "${#MARKETING_DEMO_LEAD_OPERATIONS_SECRET}" -ge 32
  test "${#MARKETING_DEMO_LEAD_UNSUBSCRIBE_SECRET}" -ge 32
  test "${#MARKETING_DEMO_LEAD_WEBHOOK_SECRET}" -ge 32
  test "${#REALTIME_API_KEY}" -ge 32
  decoded_bytes="$(printf %s "$MARKETING_DEMO_HANDOFF_ENCRYPTION_KEY" | openssl base64 -d -A 2>/dev/null | wc -c | tr -d " ")"
  test "$decoded_bytes" = 32
  test "$HIRECALL_WORKTREE_ID" = "$1"
  test "$PRELUDE_WORKTREE_ID" = "$1"
  test "$COMPOSE_PROJECT_NAME" = "$2"
  test "$NEXT_PUBLIC_CONSOLE_URL" = "$3"
  test "$NEXT_PUBLIC_CANDIDATE_URL" = "$4"
  test "$MARKETING_DEMO_LOCAL_RETURN_TARGET" = "$5"
  test "$MARKETING_DEMO_RETURN_TARGETS" = "$6"
  test "$POSTGRES_PORT" = "$7"
  test "$REDIS_PORT" = "$8"
  test "$REALTIME_PORT" = "$9"
  test "$PRELUDE_ALLOWED_DEV_ORIGINS" = "${10}"
' sh "$WORKTREE_ID" "$COMPOSE_PROJECT" "$CONSOLE_URL_VALUE" "$CANDIDATE_URL_VALUE" \
  "$MARKETING_DEMO_RETURN_TARGET_VALUE" "$MARKETING_DEMO_RETURN_TARGETS_VALUE" \
  "$POSTGRES_PORT_VALUE" "$REDIS_PORT_VALUE" "$REALTIME_PORT_VALUE" \
  "$PRELUDE_ALLOWED_DEV_ORIGINS_VALUE" >/dev/null 2>&1; then
  printf 'Generated worktree secrets are missing or invalid. Rerun `make init`.\n' >&2
  exit 1
fi

metadata_file="$repo_root/.worktree/metadata.env"
if [ ! -f "$metadata_file" ] || [ ! -f "$repo_root/.worktree/generated-metadata" ]; then
  printf 'Missing generated worktree metadata. Rerun `make init`.\n' >&2
  exit 1
fi
expected_metadata_checksum="$(sed -n '1p' "$repo_root/.worktree/generated-metadata")"
actual_metadata_checksum="$(cksum "$metadata_file" | awk '{ print $1 ":" $2 }')"
if [ "$expected_metadata_checksum" != "$actual_metadata_checksum" ]; then
  printf 'Generated worktree metadata was modified. Rerun `make init`.\n' >&2
  exit 1
fi

printf 'Worktree environment %s is valid.\n' "$WORKTREE_ID"
