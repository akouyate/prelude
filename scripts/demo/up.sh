#!/bin/sh
set -eu

repo_root="$(git rev-parse --show-toplevel)"
compose="$repo_root/scripts/worktree/compose.sh"

# Bootstrap and configuration-check containers intentionally reuse the
# Candidate image but do not define their own build block. Build shared images
# first so Compose never tries to pull a worktree-scoped local image.
"$compose" --profile marketing-demo pull postgres redis
"$compose" --profile marketing-demo build candidate realtime interviewer-agent
exec "$compose" --profile marketing-demo up -d --no-build --pull never --wait
