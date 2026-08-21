#!/bin/sh
set -eu

repo_root="$(git rev-parse --show-toplevel)"
metadata="$repo_root/.worktree/metadata.env"
if [ ! -f "$metadata" ]; then
  printf 'Missing worktree metadata. Run `make init`.\n' >&2
  exit 1
fi

# The metadata is setup-owned and intentionally contains no secrets.
. "$metadata"
cat <<EOF
HireCall local workspace: $HIRECALL_WORKTREE_ID
  Landing:          $LANDING_URL
  Console:          $CONSOLE_URL
  Candidate:        $CANDIDATE_URL
  Realtime health:  $REALTIME_URL/health
  Demo return:      $MARKETING_DEMO_RETURN_TARGET
  Compose project:  $COMPOSE_PROJECT_NAME
EOF
