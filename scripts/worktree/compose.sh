#!/bin/sh
set -eu

repo_root="$(git rev-parse --show-toplevel)"
if [ ! -f "$repo_root/.env.worktree" ]; then
  printf 'Missing .env.worktree. Run `make init`.\n' >&2
  exit 1
fi

exec "$repo_root/scripts/run-with-env.sh" docker compose "$@"
