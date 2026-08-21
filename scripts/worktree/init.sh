#!/bin/sh
set -eu

umask 077

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

. "$repo_root/scripts/worktree/lib.sh"

state_dir="$repo_root/.worktree"
worktree_env="$repo_root/.env.worktree"
env_keys="$repo_root/.env.keys"
mkdir -p "$state_dir"
chmod 700 "$state_dir"

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    printf '%s is required for worktree setup.\n' "$1" >&2
    exit 1
  fi
}

require_command git
require_command openssl
require_command dotenvx
require_command pnpm

primary_worktree="$(git worktree list --porcelain | awk '/^worktree / { print substr($0, 10); exit }')"
if [ ! -f "$env_keys" ]; then
  source_keys="$primary_worktree/.env.keys"
  if [ ! -f "$source_keys" ]; then
    printf 'Missing .env.keys in this checkout and the primary worktree.\n' >&2
    printf 'Install the team key in %s, then rerun make init.\n' "$primary_worktree" >&2
    exit 1
  fi
  cp "$source_keys" "$env_keys"
  chmod 600 "$env_keys"
  cksum "$env_keys" | awk '{ print $1 ":" $2 }' > "$state_dir/copied-env-keys"
fi

shared_probe="$(dotenvx get REALTIME_API_KEY -f "$repo_root/.env" 2>/dev/null || true)"
case "$shared_probe" in
  ""|encrypted:*)
    printf 'The copied .env.keys cannot decrypt the repository .env.\n' >&2
    exit 1
    ;;
esac
unset shared_probe

env_origin_file="$state_dir/env-override-origin"
original_worktree_env="$state_dir/original-env-override"
if [ ! -f "$env_origin_file" ]; then
  if [ -f "$worktree_env" ]; then
    cp "$worktree_env" "$original_worktree_env"
    chmod 600 "$original_worktree_env"
    printf 'existing\n' > "$env_origin_file"
  else
    printf 'generated\n' > "$env_origin_file"
  fi
  chmod 600 "$env_origin_file"
fi

if [ ! -f "$worktree_env" ]; then
  printf '# Managed by scripts/worktree/init.sh. Local and gitignored.\n' > "$worktree_env"
fi
chmod 600 "$worktree_env"

worktree_id="$(resolve_worktree_id "$repo_root" "$worktree_env")"
assert_no_registered_worktree_collision "$repo_root" "$worktree_id"
assert_compose_ports_available "$worktree_id"
load_worktree_values "$worktree_id"

ensure_value() {
  key="$1"
  value="$2"
  if ! grep -q "^${key}=" "$worktree_env"; then
    printf '%s=%s\n' "$key" "$value" >> "$worktree_env"
  fi
}

ensure_value MARKETING_DEMO_SERVICE_SECRET "$(openssl rand -hex 32)"
ensure_value MARKETING_DEMO_HANDOFF_ENCRYPTION_KEY "$(openssl rand -base64 32 | tr -d '\n')"
ensure_value MARKETING_DEMO_LEAD_OPERATIONS_SECRET "$(openssl rand -hex 32)"
ensure_value MARKETING_DEMO_LEAD_UNSUBSCRIBE_SECRET "$(openssl rand -hex 32)"
ensure_value MARKETING_DEMO_LEAD_WEBHOOK_SECRET "$(openssl rand -hex 32)"
ensure_value REALTIME_API_KEY "$(openssl rand -hex 32)"

# Unlike secrets, these values are setup-owned and refreshed together. This
# prevents a stale port or return target from crossing worktree boundaries.
upsert_env_value "$worktree_env" HIRECALL_WORKTREE_ID "$WORKTREE_ID"
upsert_env_value "$worktree_env" PRELUDE_WORKTREE_ID "$WORKTREE_ID"
upsert_env_value "$worktree_env" HIRECALL_LOCAL_DOMAIN "$HIRECALL_LOCAL_DOMAIN"
upsert_env_value "$worktree_env" COMPOSE_PROJECT_NAME "$COMPOSE_PROJECT"
upsert_env_value "$worktree_env" CONSOLE_PORT "$CONSOLE_PORT_VALUE"
upsert_env_value "$worktree_env" CANDIDATE_PORT "$CANDIDATE_PORT_VALUE"
upsert_env_value "$worktree_env" LANDING_PORT "$LANDING_PORT_VALUE"
upsert_env_value "$worktree_env" REALTIME_PORT "$REALTIME_PORT_VALUE"
upsert_env_value "$worktree_env" POSTGRES_PORT "$POSTGRES_PORT_VALUE"
upsert_env_value "$worktree_env" REDIS_PORT "$REDIS_PORT_VALUE"
upsert_env_value "$worktree_env" CLAMAV_PORT "$CLAMAV_PORT_VALUE"
upsert_env_value "$worktree_env" DATABASE_URL "postgresql://postgres:postgres@127.0.0.1:${POSTGRES_PORT_VALUE}/prelude?schema=public"
upsert_env_value "$worktree_env" REDIS_URL "redis://127.0.0.1:${REDIS_PORT_VALUE}/0"
upsert_env_value "$worktree_env" NEXT_PUBLIC_CONSOLE_URL "$CONSOLE_URL_VALUE"
upsert_env_value "$worktree_env" NEXT_PUBLIC_CANDIDATE_URL "$CANDIDATE_URL_VALUE"
upsert_env_value "$worktree_env" CONSOLE_URL "$CONSOLE_URL_VALUE"
upsert_env_value "$worktree_env" CANDIDATE_URL "$CANDIDATE_URL_VALUE"
upsert_env_value "$worktree_env" LANDING_URL "$LANDING_URL_VALUE"
upsert_env_value "$worktree_env" REALTIME_URL "$REALTIME_URL_VALUE"
upsert_env_value "$worktree_env" PRELUDE_ALLOWED_DEV_ORIGINS "$PRELUDE_ALLOWED_DEV_ORIGINS_VALUE"
upsert_env_value "$worktree_env" REALTIME_API_URL "$REALTIME_URL_VALUE"
upsert_env_value "$worktree_env" PRELUDE_REALTIME_API_URL "$REALTIME_URL_VALUE"
upsert_env_value "$worktree_env" MARKETING_DEMO_LOCAL_RETURN_TARGET "$MARKETING_DEMO_RETURN_TARGET_VALUE"
upsert_env_value "$worktree_env" MARKETING_DEMO_RETURN_TARGET "$MARKETING_DEMO_RETURN_TARGET_VALUE"
upsert_env_value "$worktree_env" MARKETING_DEMO_RETURN_TARGETS "$MARKETING_DEMO_RETURN_TARGETS_VALUE"
upsert_env_value "$worktree_env" AGENT_JOIN_STREAM_KEY "prelude:${WORKTREE_ID}:agent-join:stream"
upsert_env_value "$worktree_env" AGENT_JOIN_CONSUMER_GROUP "prelude-${WORKTREE_ID}-live-workers"
local_no_proxy="localhost,127.0.0.1,::1,.localhost"
case ",${NO_PROXY:-}," in
  *,.localhost,*) ;;
  *,"",*) ;;
  *) local_no_proxy="${NO_PROXY},${local_no_proxy}" ;;
esac
upsert_env_value "$worktree_env" NO_PROXY "$local_no_proxy"
upsert_env_value "$worktree_env" no_proxy "$local_no_proxy"

metadata_file="$state_dir/metadata.env"
write_worktree_metadata "$metadata_file"
cksum "$metadata_file" | awk '{ print $1 ":" $2 }' > "$state_dir/generated-metadata"

cksum "$worktree_env" | awk '{ print $1 ":" $2 }' > "$state_dir/generated-env-override"
chmod 600 "$state_dir/generated-env-override"
rm -f "$state_dir/created-env-override"

unset env_origin_file original_worktree_env key value worktree_id metadata_file local_no_proxy

pnpm install --frozen-lockfile
pnpm --filter @prelude/db db:generate

"$repo_root/scripts/worktree/check.sh"
printf 'Worktree initialization complete. Run `make urls` for local endpoints.\n'
