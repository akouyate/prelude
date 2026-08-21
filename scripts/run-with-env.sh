#!/bin/sh
set -eu

repo_root="$(git rev-parse --show-toplevel)"
encrypted_env="$repo_root/.env"
worktree_env="$repo_root/.env.worktree"

if ! command -v dotenvx >/dev/null 2>&1; then
  printf 'dotenvx is required. Run `make init` first.\n' >&2
  exit 1
fi

if [ -f "$worktree_env" ]; then
  exec dotenvx run -f "$encrypted_env" -f "$worktree_env" -- "$@"
fi

exec dotenvx run -f "$encrypted_env" -- "$@"
