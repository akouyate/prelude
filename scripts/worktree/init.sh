#!/bin/sh
set -eu

umask 077

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

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

created_worktree_env=0
if [ ! -f "$worktree_env" ]; then
  printf '# Managed by scripts/worktree/init.sh. Local and gitignored.\n' > "$worktree_env"
  created_worktree_env=1
fi
chmod 600 "$worktree_env"

ensure_value() {
  key="$1"
  value="$2"
  if ! grep -q "^${key}=" "$worktree_env"; then
    printf '%s=%s\n' "$key" "$value" >> "$worktree_env"
  fi
}

ensure_value MARKETING_DEMO_SERVICE_SECRET "$(openssl rand -hex 32)"
ensure_value MARKETING_DEMO_HANDOFF_ENCRYPTION_KEY "$(openssl rand -base64 32 | tr -d '\n')"
ensure_value REALTIME_API_KEY "$(openssl rand -hex 32)"
ensure_value MARKETING_DEMO_LOCAL_RETURN_TARGET "http://localhost:3200/demo/result"

if [ "$created_worktree_env" = "1" ]; then
  cksum "$worktree_env" | awk '{ print $1 ":" $2 }' > "$state_dir/created-env-override"
fi

unset created_worktree_env key value

pnpm install --frozen-lockfile
pnpm --filter @prelude/db db:generate

"$repo_root/scripts/worktree/check.sh"
printf 'Worktree initialization complete.\n'
