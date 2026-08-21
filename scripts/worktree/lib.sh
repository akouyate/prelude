#!/bin/sh

# Shared, POSIX-compatible worktree identity and local endpoint helpers.
# This file is sourced by setup, checks, Compose wrappers, and ops tests.

worktree_repo_root() {
  git rev-parse --show-toplevel
}

worktree_primary_root() {
  git worktree list --porcelain | awk '/^worktree / { print substr($0, 10); exit }'
}

sanitize_worktree_id() {
  printf '%s' "$1" |
    tr '[:upper:]' '[:lower:]' |
    sed -e 's/[^a-z0-9-]/-/g' -e 's/--*/-/g' -e 's/^-//' -e 's/-$//' |
    cut -c1-40 |
    sed -e 's/-$//'
}

validate_worktree_id() {
  candidate="$1"
  case "$candidate" in
    ""|-*|*-|*[!a-z0-9-]*)
      printf 'Invalid HIRECALL_WORKTREE_ID %s; use 1-40 lowercase letters, digits, or hyphens.\n' "$candidate" >&2
      return 1
      ;;
  esac
  if [ "${#candidate}" -gt 40 ]; then
    printf 'HIRECALL_WORKTREE_ID is longer than 40 characters.\n' >&2
    return 1
  fi
}

auto_worktree_id_for_path() {
  target_root="$1"
  primary_root="$2"

  if [ "$target_root" = "$primary_root" ]; then
    printf 'main\n'
    return
  fi

  repo_name="$(basename "$primary_root")"
  target_name="$(basename "$target_root")"
  if [ "$target_name" = "$repo_name" ]; then
    target_name="$(basename "$(dirname "$target_root")")"
  fi
  target_name="$(sanitize_worktree_id "$target_name")"
  if [ -z "$target_name" ] || [ "$target_name" = "worktrees" ]; then
    target_name="worktree-$(printf '%s' "$target_root" | cksum | awk '{ print $1 }')"
  fi
  validate_worktree_id "$target_name"
  printf '%s\n' "$target_name"
}

persisted_worktree_id() {
  env_file="$1"
  [ -f "$env_file" ] || return 1
  sed -n 's/^HIRECALL_WORKTREE_ID=//p' "$env_file" | tail -n 1
}

resolve_worktree_id() {
  repo_root="$1"
  env_file="$2"

  if [ -n "${HIRECALL_WORKTREE_ID:-}" ] &&
    [ -n "${PRELUDE_WORKTREE_ID:-}" ] &&
    [ "$HIRECALL_WORKTREE_ID" != "$PRELUDE_WORKTREE_ID" ]; then
    printf 'HIRECALL_WORKTREE_ID and PRELUDE_WORKTREE_ID disagree.\n' >&2
    return 1
  fi

  persisted_id="$(persisted_worktree_id "$env_file" 2>/dev/null || true)"
  explicit_id="${HIRECALL_WORKTREE_ID:-${PRELUDE_WORKTREE_ID:-}}"
  if [ -n "$explicit_id" ]; then
    validate_worktree_id "$explicit_id"
    if [ -n "$persisted_id" ] && [ "$persisted_id" != "$explicit_id" ]; then
      printf 'This checkout is already initialized as %s; cleanup it before changing to %s.\n' "$persisted_id" "$explicit_id" >&2
      return 1
    fi
    printf '%s\n' "$explicit_id"
    return
  fi

  if [ -n "$persisted_id" ]; then
    validate_worktree_id "$persisted_id"
    printf '%s\n' "$persisted_id"
    return
  fi

  auto_worktree_id_for_path "$repo_root" "$(worktree_primary_root)"
}

worktree_port_base() {
  worktree_id="$1"
  if [ "$worktree_id" = "main" ]; then
    printf '0\n'
    return
  fi
  slot="$(printf '%s' "$worktree_id" | cksum | awk '{ print $1 % 4000 }')"
  printf '%s\n' "$((20000 + (slot * 10)))"
}

worktree_port() {
  worktree_id="$1"
  service="$2"
  base="$(worktree_port_base "$worktree_id")"

  if [ "$worktree_id" = "main" ]; then
    case "$service" in
      console) printf '3000\n' ;;
      candidate) printf '3101\n' ;;
      landing) printf '3200\n' ;;
      realtime) printf '8080\n' ;;
      postgres) printf '5440\n' ;;
      redis) printf '6380\n' ;;
      clamav) printf '3310\n' ;;
      *) printf 'Unknown worktree service: %s\n' "$service" >&2; return 1 ;;
    esac
    return
  fi

  case "$service" in
    console) offset=0 ;;
    candidate) offset=1 ;;
    landing) offset=2 ;;
    realtime) offset=3 ;;
    postgres) offset=4 ;;
    redis) offset=5 ;;
    clamav) offset=6 ;;
    *) printf 'Unknown worktree service: %s\n' "$service" >&2; return 1 ;;
  esac
  printf '%s\n' "$((base + offset))"
}

worktree_domain() {
  printf 'hirecall-%s.localhost\n' "$1"
}

worktree_compose_project() {
  if [ "$1" = "main" ]; then
    printf 'prelude\n'
  else
    printf 'prelude-%s\n' "$1"
  fi
}

load_worktree_values() {
  WORKTREE_ID="$1"
  HIRECALL_LOCAL_DOMAIN="$(worktree_domain "$WORKTREE_ID")"
  COMPOSE_PROJECT="$(worktree_compose_project "$WORKTREE_ID")"
  CONSOLE_PORT_VALUE="$(worktree_port "$WORKTREE_ID" console)"
  CANDIDATE_PORT_VALUE="$(worktree_port "$WORKTREE_ID" candidate)"
  LANDING_PORT_VALUE="$(worktree_port "$WORKTREE_ID" landing)"
  REALTIME_PORT_VALUE="$(worktree_port "$WORKTREE_ID" realtime)"
  POSTGRES_PORT_VALUE="$(worktree_port "$WORKTREE_ID" postgres)"
  REDIS_PORT_VALUE="$(worktree_port "$WORKTREE_ID" redis)"
  CLAMAV_PORT_VALUE="$(worktree_port "$WORKTREE_ID" clamav)"
  CONSOLE_URL_VALUE="http://app.${HIRECALL_LOCAL_DOMAIN}:${CONSOLE_PORT_VALUE}"
  CANDIDATE_URL_VALUE="http://candidate.${HIRECALL_LOCAL_DOMAIN}:${CANDIDATE_PORT_VALUE}"
  LANDING_URL_VALUE="http://www.${HIRECALL_LOCAL_DOMAIN}:${LANDING_PORT_VALUE}"
  REALTIME_URL_VALUE="http://realtime.${HIRECALL_LOCAL_DOMAIN}:${REALTIME_PORT_VALUE}"
  PRELUDE_ALLOWED_DEV_ORIGINS_VALUE="app.${HIRECALL_LOCAL_DOMAIN},candidate.${HIRECALL_LOCAL_DOMAIN},www.${HIRECALL_LOCAL_DOMAIN}"
  MARKETING_DEMO_RETURN_TARGET_VALUE="${LANDING_URL_VALUE}/demo/result"
  CONSOLE_DEMO_RETURN_TARGET_VALUE="${CONSOLE_URL_VALUE}/demo/result"
  MARKETING_DEMO_RETURN_TARGETS_VALUE="${MARKETING_DEMO_RETURN_TARGET_VALUE},${CONSOLE_DEMO_RETURN_TARGET_VALUE}"
}

assert_no_registered_worktree_collision() {
  repo_root="$1"
  worktree_id="$2"
  wanted_base="$(worktree_port_base "$worktree_id")"
  primary_root="$(worktree_primary_root)"

  git worktree list --porcelain | sed -n 's/^worktree //p' | while IFS= read -r other_root; do
    [ "$other_root" = "$repo_root" ] && continue
    other_env="$other_root/.env.worktree"
    other_id="$(persisted_worktree_id "$other_env" 2>/dev/null || true)"
    if [ -z "$other_id" ]; then
      other_id="$(auto_worktree_id_for_path "$other_root" "$primary_root")"
    fi
    if [ "$other_id" = "$worktree_id" ]; then
      printf 'Worktree ID %s is already assigned to %s.\n' "$worktree_id" "$other_root" >&2
      exit 1
    fi
    other_base="$(worktree_port_base "$other_id")"
    if [ "$wanted_base" != "0" ] && [ "$wanted_base" = "$other_base" ]; then
      printf 'Port block collision between %s and %s; set a different HIRECALL_WORKTREE_ID.\n' "$worktree_id" "$other_id" >&2
      exit 1
    fi
  done
}

port_has_listener() {
  port="$1"
  if command -v lsof >/dev/null 2>&1; then
    lsof -nP -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null | grep -q .
    return
  fi
  if command -v docker >/dev/null 2>&1; then
    docker ps --filter "publish=$port" --format '{{.ID}}' 2>/dev/null | grep -q .
    return
  fi
  return 1
}

port_is_owned_by_compose_project() {
  port="$1"
  project="$2"
  command -v docker >/dev/null 2>&1 || return 1
  docker ps --filter "publish=$port" --format '{{.Label "com.docker.compose.project"}}' 2>/dev/null |
    grep -Fxq "$project"
}

assert_compose_ports_available() {
  worktree_id="$1"
  project="$(worktree_compose_project "$worktree_id")"
  for service in postgres redis clamav realtime candidate; do
    port="$(worktree_port "$worktree_id" "$service")"
    if port_has_listener "$port" && ! port_is_owned_by_compose_project "$port" "$project"; then
      printf 'Port %s for %s is already used outside Compose project %s.\n' "$port" "$service" "$project" >&2
      return 1
    fi
  done
}

upsert_env_value() {
  env_file="$1"
  key="$2"
  value="$3"
  temp_file="$(mktemp "${env_file}.XXXXXX")"
  awk -v key="$key" -v value="$value" '
    BEGIN { replaced = 0 }
    index($0, key "=") == 1 {
      if (!replaced) print key "=" value
      replaced = 1
      next
    }
    { print }
    END { if (!replaced) print key "=" value }
  ' "$env_file" > "$temp_file"
  chmod 600 "$temp_file"
  mv "$temp_file" "$env_file"
}

write_worktree_metadata() {
  output="$1"
  mkdir -p "$(dirname "$output")"
  temp_file="$(mktemp "${output}.XXXXXX")"
  cat > "$temp_file" <<EOF
# Generated by scripts/worktree/init.sh. Contains no secrets.
HIRECALL_WORKTREE_ID=$WORKTREE_ID
HIRECALL_LOCAL_DOMAIN=$HIRECALL_LOCAL_DOMAIN
COMPOSE_PROJECT_NAME=$COMPOSE_PROJECT
CONSOLE_PORT=$CONSOLE_PORT_VALUE
CANDIDATE_PORT=$CANDIDATE_PORT_VALUE
LANDING_PORT=$LANDING_PORT_VALUE
REALTIME_PORT=$REALTIME_PORT_VALUE
POSTGRES_PORT=$POSTGRES_PORT_VALUE
REDIS_PORT=$REDIS_PORT_VALUE
CLAMAV_PORT=$CLAMAV_PORT_VALUE
CONSOLE_URL=$CONSOLE_URL_VALUE
CANDIDATE_URL=$CANDIDATE_URL_VALUE
LANDING_URL=$LANDING_URL_VALUE
REALTIME_URL=$REALTIME_URL_VALUE
PRELUDE_ALLOWED_DEV_ORIGINS=$PRELUDE_ALLOWED_DEV_ORIGINS_VALUE
MARKETING_DEMO_RETURN_TARGET=$MARKETING_DEMO_RETURN_TARGET_VALUE
CONSOLE_DEMO_RETURN_TARGET=$CONSOLE_DEMO_RETURN_TARGET_VALUE
MARKETING_DEMO_RETURN_TARGETS=$MARKETING_DEMO_RETURN_TARGETS_VALUE
EOF
  chmod 600 "$temp_file"
  mv "$temp_file" "$output"
}
