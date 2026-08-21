#!/bin/sh
set -eu

repo_root="$(git rev-parse --show-toplevel)"
. "$repo_root/scripts/worktree/lib.sh"

fail() {
  printf 'worktree test failed: %s\n' "$1" >&2
  exit 1
}

assert_equal() {
  [ "$1" = "$2" ] || fail "expected '$2', got '$1'"
}

assert_equal "$(sanitize_worktree_id 'Feature/Demo_name')" "feature-demo-name"
validate_worktree_id "issue-168"
if validate_worktree_id "Issue 168" >/dev/null 2>&1; then
  fail "invalid explicit ID was accepted"
fi

temp_dir="$(mktemp -d)"
trap 'rm -rf "$temp_dir"' EXIT HUP INT TERM
printf 'HIRECALL_WORKTREE_ID=persisted\n' > "$temp_dir/env"
if (HIRECALL_WORKTREE_ID=changed; export HIRECALL_WORKTREE_ID; resolve_worktree_id "$repo_root" "$temp_dir/env") >/dev/null 2>&1; then
  fail "an initialized worktree ID changed without cleanup"
fi
assert_equal "$(resolve_worktree_id "$repo_root" "$temp_dir/env")" "persisted"

load_worktree_values "issue-168"
assert_equal "$HIRECALL_LOCAL_DOMAIN" "hirecall-issue-168.localhost"
assert_equal "$CONSOLE_URL_VALUE" "http://app.hirecall-issue-168.localhost:${CONSOLE_PORT_VALUE}"
assert_equal "$CANDIDATE_URL_VALUE" "http://candidate.hirecall-issue-168.localhost:${CANDIDATE_PORT_VALUE}"
assert_equal "$MARKETING_DEMO_RETURN_TARGET_VALUE" "http://www.hirecall-issue-168.localhost:${LANDING_PORT_VALUE}/demo/result"
assert_equal "$MARKETING_DEMO_RETURN_TARGETS_VALUE" "${MARKETING_DEMO_RETURN_TARGET_VALUE},${CONSOLE_DEMO_RETURN_TARGET_VALUE}"

seen=" "
for service in console candidate landing realtime postgres redis clamav; do
  port="$(worktree_port issue-168 "$service")"
  [ "$port" -ge 20000 ] && [ "$port" -le 59999 ] || fail "$service port is outside the allocated range"
  case "$seen" in
    *" $port "*) fail "duplicate port $port" ;;
  esac
  seen="${seen}${port} "
done

long_id="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
validate_worktree_id "$long_id"
parent_domain="$(worktree_domain "$long_id")"
[ "${#parent_domain}" -le 63 ] || fail "generated parent domain label is too long"

load_worktree_values main
assert_equal "$COMPOSE_PROJECT" "prelude"
assert_equal "$POSTGRES_PORT_VALUE" "5440"
assert_equal "$REDIS_PORT_VALUE" "6380"

load_worktree_values issue-168
metadata="$temp_dir/metadata.env"
write_worktree_metadata "$metadata"
grep -Fq 'MARKETING_DEMO_RETURN_TARGETS=http://www.hirecall-issue-168.localhost:' "$metadata" || fail "metadata omitted return targets"
if grep -Eiq '(secret|token|password|key)=' "$metadata"; then
  fail "non-secret metadata contains a secret-shaped key"
fi

for script in \
  scripts/worktree/init.sh \
  scripts/worktree/check.sh \
  scripts/worktree/cleanup.sh \
  scripts/worktree/compose.sh \
  scripts/worktree/urls.sh \
  scripts/worktree/landing-env.sh \
  scripts/demo/up.sh \
  scripts/demo/down.sh \
  scripts/demo/logs.sh; do
  sh -n "$repo_root/$script" || fail "$script has invalid shell syntax"
done

if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
  compose_config="$temp_dir/compose.yaml"
  COMPOSE_PROJECT_NAME=prelude-ops-test \
  POSTGRES_PORT=59104 REDIS_PORT=59105 CLAMAV_PORT=59106 \
  REALTIME_PORT=59103 CANDIDATE_PORT=59101 \
  CANDIDATE_URL=http://candidate.hirecall-ops-test.localhost:59101 \
  MARKETING_DEMO_RETURN_TARGETS=http://www.hirecall-ops-test.localhost:59102/demo/result,http://app.hirecall-ops-test.localhost:59100/demo/result \
    docker compose --profile marketing-demo -f "$repo_root/docker-compose.yml" config > "$compose_config"
  grep -Fq 'name: prelude-ops-test_postgres_data' "$compose_config" || fail "Postgres volume is not project-scoped"
  grep -Fq 'http://candidate.hirecall-ops-test.localhost:59101' "$compose_config" || fail "Candidate public URL was not propagated"
  grep -Fq 'http://www.hirecall-ops-test.localhost:59102/demo/result,http://app.hirecall-ops-test.localhost:59100/demo/result' "$compose_config" || fail "exact return-target allow-list was not propagated"
fi

printf 'Worktree domain and isolation tests passed.\n'
