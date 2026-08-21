#!/bin/sh
set -eu

repo_root="$(git rev-parse --show-toplevel)"
compose="$repo_root/scripts/worktree/compose.sh"

"$compose" --profile marketing-demo stop candidate realtime interviewer-agent
exec "$compose" --profile marketing-demo rm -f \
  candidate realtime interviewer-agent demo-bootstrap demo-config-check
