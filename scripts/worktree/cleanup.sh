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

env_origin_file="$state_dir/env-override-origin"
generated_env_checksum="$state_dir/generated-env-override"
original_worktree_env="$state_dir/original-env-override"
if [ -f "$env_origin_file" ] && [ -f "$generated_env_checksum" ] && \
  managed_file_is_unchanged "$repo_root/.env.worktree" "$generated_env_checksum"; then
  env_origin="$(sed -n '1p' "$env_origin_file")"
  if [ "$env_origin" = "existing" ] && [ -f "$original_worktree_env" ]; then
    mv "$original_worktree_env" "$repo_root/.env.worktree"
    chmod 600 "$repo_root/.env.worktree"
    printf 'Restored the pre-init .env.worktree.\n'
  elif [ "$env_origin" = "generated" ]; then
    rm -f "$repo_root/.env.worktree"
    printf 'Removed the generated .env.worktree.\n'
  else
    printf 'Invalid worktree environment ownership metadata; preserving files.\n' >&2
    exit 1
  fi
  rm -f "$env_origin_file" "$generated_env_checksum" "$state_dir/created-env-override"
elif [ -f "$env_origin_file" ] && [ ! -f "$generated_env_checksum" ]; then
  env_origin="$(sed -n '1p' "$env_origin_file")"
  if [ "$env_origin" = "existing" ] && [ -f "$original_worktree_env" ]; then
    mv "$original_worktree_env" "$repo_root/.env.worktree"
    chmod 600 "$repo_root/.env.worktree"
    printf 'Restored .env.worktree after an interrupted setup.\n'
  elif [ "$env_origin" = "generated" ]; then
    rm -f "$repo_root/.env.worktree"
    printf 'Removed .env.worktree from an interrupted setup.\n'
  fi
  rm -f "$env_origin_file" "$state_dir/created-env-override"
elif [ -f "$generated_env_checksum" ]; then
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

if [ -f "$state_dir/generated-metadata" ] && \
  managed_file_is_unchanged "$state_dir/metadata.env" "$state_dir/generated-metadata"; then
  rm -f "$state_dir/metadata.env" "$state_dir/generated-metadata"
  printf 'Removed generated worktree metadata.\n'
elif [ -f "$state_dir/generated-metadata" ]; then
  printf 'Preserved worktree metadata because it was modified after setup.\n'
fi

if [ -f "$state_dir/generated-landing-env" ] && \
  managed_file_is_unchanged "$state_dir/marketing-landing.env" "$state_dir/generated-landing-env"; then
  rm -f "$state_dir/marketing-landing.env" "$state_dir/generated-landing-env"
  printf 'Removed generated marketing landing environment.\n'
elif [ -f "$state_dir/generated-landing-env" ]; then
  printf 'Preserved marketing landing environment because it was modified after setup.\n'
fi

rmdir "$state_dir" 2>/dev/null || true
printf 'Worktree cleanup complete. Docker volumes and application data were preserved.\n'
