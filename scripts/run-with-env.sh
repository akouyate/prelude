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
  # dotenvx keeps the first value it encounters, so the generated local
  # override must be listed before the shared encrypted environment.
  exec dotenvx run -f "$worktree_env" -f "$encrypted_env" -- "$@"
fi

exec dotenvx run -f "$encrypted_env" -- "$@"
