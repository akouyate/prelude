#!/bin/sh
set -eu

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

state_dir="$repo_root/.worktree"

managed_file_is_unchanged() {
  file="$1"
  checksum_file="$2"
  [ -f "$file" ] || return 0
  expected="$(sed -n '1p' "$checksum_file")"
  actual="$(cksum "$file" | awk '{ print $1 ":" $2 }')"
  [ -n "$expected" ] && [ "$actual" = "$expected" ]
}

if [ -f "$state_dir/created-env-override" ] && \
  managed_file_is_unchanged "$repo_root/.env.worktree" "$state_dir/created-env-override"; then
  rm -f "$repo_root/.env.worktree"
  rm -f "$state_dir/created-env-override"
  printf 'Removed the generated .env.worktree.\n'
elif [ -f "$state_dir/created-env-override" ]; then
  printf 'Preserved .env.worktree because it was modified after setup.\n'
fi

if [ -f "$state_dir/copied-env-keys" ] && \
  managed_file_is_unchanged "$repo_root/.env.keys" "$state_dir/copied-env-keys"; then
  rm -f "$repo_root/.env.keys"
  rm -f "$state_dir/copied-env-keys"
  printf 'Removed the worktree copy of .env.keys; the primary copy is unchanged.\n'
elif [ -f "$state_dir/copied-env-keys" ]; then
  printf 'Preserved .env.keys because it was modified after setup.\n'
fi

rmdir "$state_dir" 2>/dev/null || true
printf 'Worktree cleanup complete. Docker volumes and application data were preserved.\n'
