SHELL := /bin/sh

COMPOSE ?= docker compose
POSTGRES_PORT ?= 5440
REDIS_PORT ?= 6379
DATABASE_URL ?= postgresql://postgres:postgres@localhost:$(POSTGRES_PORT)/prelude?schema=public
REDIS_URL ?= redis://localhost:$(REDIS_PORT)/0
PYTHON_VERSION ?= 3.14
MIGRATION_NAME ?= init
# .env is dotenvx-encrypted; decrypt it through dotenvx (needs .env.keys) and
# export the values. Falls back silently if .env/dotenvx is absent.
LOAD_ENV := set -a; [ ! -f .env ] || eval "$$(dotenvx get --format eval -f .env 2>/dev/null)"; set +a
BENCHMARK_PROVIDER ?= mock_openai_realtime
BENCHMARK_SCENARIO ?= normal
BENCHMARK_ITERATIONS ?= 3
BENCHMARK_RUN_ID ?=
BENCHMARK_PERSIST_REALTIME ?=
ROLE_BENCHMARK_ITERATIONS ?= 1
ALLOW_LIVE_LLM_TESTS ?=
REALTIME_API_URL ?=
AGENT_JOIN_STREAM_KEY ?=
AGENT_JOIN_PENDING_IDLE_SECONDS ?=
LIVE_WORKER_MAX_CONCURRENCY ?=
LIVE_SMOKE_REALTIME_API_URL ?= http://127.0.0.1:8080
SESSION_ID ?=
LIVE_WORKER_SKIP_OPENAI ?=
LIVE_WORKER_MAX_DURATION_SECONDS ?=
LIVE_WORKER_CANDIDATE_READY_TIMEOUT_SECONDS ?=
LIVE_WORKER_SOFT_PROMPT_AFTER_SECONDS ?=
E2E_SMOKE_RUN_ID ?=
E2E_SMOKE_RESET ?= 1
E2E_SMOKE_CONSOLE_URL ?= http://localhost:3000
E2E_SMOKE_LIVE_LLM ?=
VOICE_SMOKE_TTS ?= pocket
VOICE_SMOKE_INTERVIEW_PLAN_ID ?= interview_e2e_local-live
VOICE_SMOKE_VOICE ?=
VOICE_SMOKE_MAX_SECONDS ?= 240
VOICE_SMOKE_PYTHON ?= 3.13

.DEFAULT_GOAL := help

.PHONY: help env-up env-down env-reset db-logs db-shell redis-shell db-migrate db-generate db-studio test-services test-realtime test-agent agent-benchmark agent-role-benchmark live-openai-worker live-openai-autoworker live-smoke-report live-smoke-report-strict e2e-smoke e2e-smoke-live e2e-voice-smoke dev

help: ## List available local development commands.
	@awk 'BEGIN {FS = ":.*## "; printf "Prelude local commands:\n"} /^[a-zA-Z0-9_-]+:.*## / {printf "  %-16s %s\n", $$1, $$2}' $(MAKEFILE_LIST)

env-up: ## Start local Docker services.
	$(COMPOSE) up -d
	@printf "Waiting for Postgres to become healthy"
	@container_id="$$( $(COMPOSE) ps -q postgres )"; \
	if [ -z "$$container_id" ]; then \
		printf "\nPostgres container was not created.\n"; \
		exit 1; \
	fi; \
	for attempt in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24; do \
		status="$$( docker inspect --format '{{.State.Health.Status}}' "$$container_id" 2>/dev/null || true )"; \
		if [ "$$status" = "healthy" ]; then \
			printf "\nPostgres is healthy.\n"; \
			exit 0; \
		fi; \
		printf "."; \
		sleep 2; \
	done; \
	printf "\nPostgres did not become healthy in time.\n"; \
	$(COMPOSE) logs postgres; \
	exit 1
	@printf "Waiting for Redis to become healthy"
	@container_id="$$( $(COMPOSE) ps -q redis )"; \
	if [ -z "$$container_id" ]; then \
		printf "\nRedis container was not created.\n"; \
		exit 1; \
	fi; \
	for attempt in 1 2 3 4 5 6 7 8 9 10 11 12; do \
		status="$$( docker inspect --format '{{.State.Health.Status}}' "$$container_id" 2>/dev/null || true )"; \
		if [ "$$status" = "healthy" ]; then \
			printf "\nRedis is healthy.\n"; \
			exit 0; \
		fi; \
		printf "."; \
		sleep 2; \
	done; \
	printf "\nRedis did not become healthy in time.\n"; \
	$(COMPOSE) logs redis; \
	exit 1

env-down: ## Stop local Docker services without deleting volumes.
	$(COMPOSE) down

env-reset: ## Stop local Docker services and delete local volumes.
	$(COMPOSE) down --volumes --remove-orphans

db-logs: ## Follow local Postgres logs.
	$(COMPOSE) logs -f postgres

db-shell: ## Open a psql shell inside the local Postgres container.
	$(COMPOSE) exec postgres psql -U postgres -d prelude

redis-shell: ## Open a redis-cli shell inside the local Redis container.
	$(COMPOSE) exec redis redis-cli

db-migrate: ## Run Prisma migrations against local Postgres.
	@$(LOAD_ENV); \
	database_url="$${DATABASE_URL:-$(DATABASE_URL)}"; \
	if [ "$(origin DATABASE_URL)" = "command line" ] || [ "$(origin DATABASE_URL)" = "environment" ]; then \
		database_url="$(DATABASE_URL)"; \
	fi; \
	DATABASE_URL="$$database_url" pnpm --filter @prelude/db exec prisma migrate dev --schema prisma/schema.prisma --name "$(MIGRATION_NAME)"

db-generate: ## Regenerate the Prisma client.
	@$(LOAD_ENV); \
	database_url="$${DATABASE_URL:-$(DATABASE_URL)}"; \
	if [ "$(origin DATABASE_URL)" = "command line" ] || [ "$(origin DATABASE_URL)" = "environment" ]; then \
		database_url="$(DATABASE_URL)"; \
	fi; \
	DATABASE_URL="$$database_url" pnpm --filter @prelude/db db:generate

db-studio: ## Open Prisma Studio against local Postgres.
	@$(LOAD_ENV); \
	database_url="$${DATABASE_URL:-$(DATABASE_URL)}"; \
	if [ "$(origin DATABASE_URL)" = "command line" ] || [ "$(origin DATABASE_URL)" = "environment" ]; then \
		database_url="$(DATABASE_URL)"; \
	fi; \
	DATABASE_URL="$$database_url" pnpm --filter @prelude/db exec prisma studio --schema prisma/schema.prisma

test-services: test-realtime test-agent ## Run the Go + Python service test suites (not covered by pnpm test).

test-realtime: ## Run the Go realtime control-plane unit tests.
	cd services/realtime && go test ./...

test-agent: ## Run the Python interviewer-agent unit tests.
	cd services/interviewer-agent && PYTHONPATH=. uv run --python "$(PYTHON_VERSION)" --with-requirements requirements.txt python -m pytest tests

agent-benchmark: ## Run the Python live IA provider benchmark harness.
	@$(LOAD_ENV); \
	realtime_args=""; \
	live_llm_args=""; \
	if [ "$(BENCHMARK_PERSIST_REALTIME)" = "1" ] && [ -n "$${REALTIME_API_URL:-}" ]; then \
		realtime_args="--realtime-api-url $$REALTIME_API_URL"; \
		if [ -n "$${REALTIME_API_KEY:-}" ]; then \
			realtime_args="$$realtime_args --api-key $$REALTIME_API_KEY"; \
		fi; \
	fi; \
	if [ "$(ALLOW_LIVE_LLM_TESTS)" = "1" ] || [ "$${ALLOW_LIVE_LLM_TESTS:-}" = "1" ]; then \
		live_llm_args="--allow-live-llm-tests"; \
	fi; \
	cd services/interviewer-agent && uv run --with-requirements requirements.txt python -m app.benchmark_cli \
		--provider "$(BENCHMARK_PROVIDER)" \
		--scenario "$(BENCHMARK_SCENARIO)" \
		--iterations "$(BENCHMARK_ITERATIONS)" \
		$(if $(BENCHMARK_RUN_ID),--benchmark-run-id "$(BENCHMARK_RUN_ID)") \
		$$realtime_args \
		$$live_llm_args

agent-role-benchmark: ## Run the role-style benchmark matrix across CMO, buyer, HR, and AI orchestrator.
	@$(LOAD_ENV); \
	cd services/interviewer-agent && uv run --with-requirements requirements.txt python -m app.role_benchmark_cli \
		--provider "$(BENCHMARK_PROVIDER)" \
		--iterations "$(ROLE_BENCHMARK_ITERATIONS)" \
		$(if $(BENCHMARK_RUN_ID),--benchmark-run-id "$(BENCHMARK_RUN_ID)")

live-openai-worker: ## Run the Python OpenAI live interviewer worker for SESSION_ID.
	@test -n "$(SESSION_ID)" || (printf "SESSION_ID is required. Example: make live-openai-worker SESSION_ID=is_xxx\n"; exit 1)
	@$(LOAD_ENV); \
	realtime_api_url="$${REALTIME_API_URL:-}"; \
	if [ -n "$(REALTIME_API_URL)" ]; then \
		realtime_api_url="$(REALTIME_API_URL)"; \
	fi; \
	test -n "$$realtime_api_url" || (printf "REALTIME_API_URL is required in .env, shell, or make args.\n"; exit 1); \
	worker_args=""; \
	if [ -n "$${REALTIME_API_KEY:-}" ]; then \
		worker_args="$$worker_args --api-key $$REALTIME_API_KEY"; \
	fi; \
	if [ "$(LIVE_WORKER_SKIP_OPENAI)" = "1" ]; then \
		worker_args="$$worker_args --skip-openai-handshake"; \
	fi; \
	if [ -n "$(LIVE_WORKER_MAX_DURATION_SECONDS)" ]; then \
		export LIVE_WORKER_MAX_DURATION_SECONDS="$(LIVE_WORKER_MAX_DURATION_SECONDS)"; \
	fi; \
	if [ -n "$(LIVE_WORKER_CANDIDATE_READY_TIMEOUT_SECONDS)" ]; then \
		export LIVE_WORKER_CANDIDATE_READY_TIMEOUT_SECONDS="$(LIVE_WORKER_CANDIDATE_READY_TIMEOUT_SECONDS)"; \
	fi; \
	if [ -n "$(LIVE_WORKER_SOFT_PROMPT_AFTER_SECONDS)" ]; then \
		export LIVE_WORKER_SOFT_PROMPT_AFTER_SECONDS="$(LIVE_WORKER_SOFT_PROMPT_AFTER_SECONDS)"; \
	fi; \
	cd services/interviewer-agent && PYTHONPATH=. uv run --python "$(PYTHON_VERSION)" --with-requirements requirements.txt python -u -m app.live_worker \
		--session-id "$(SESSION_ID)" \
		--realtime-api-url "$$realtime_api_url" \
		$$worker_args

live-openai-autoworker: ## Run the Redis-backed Python auto-worker that starts live interviewer agents.
	@$(LOAD_ENV); \
	realtime_api_url="$${REALTIME_API_URL:-}"; \
	redis_url="$${REDIS_URL:-$(REDIS_URL)}"; \
	if [ -n "$(REALTIME_API_URL)" ]; then \
		realtime_api_url="$(REALTIME_API_URL)"; \
	fi; \
	if [ -n "$(REDIS_URL)" ]; then \
		redis_url="$(REDIS_URL)"; \
	fi; \
	test -n "$$realtime_api_url" || (printf "REALTIME_API_URL is required in .env, shell, or make args.\n"; exit 1); \
	test -n "$$redis_url" || (printf "REDIS_URL is required in .env, shell, or make args.\n"; exit 1); \
	worker_args=""; \
	if [ -n "$${REALTIME_API_KEY:-}" ]; then \
		worker_args="$$worker_args --api-key $$REALTIME_API_KEY"; \
	fi; \
	if [ -n "$(AGENT_JOIN_STREAM_KEY)" ]; then \
		worker_args="$$worker_args --stream-key $(AGENT_JOIN_STREAM_KEY)"; \
	fi; \
	if [ -n "$(AGENT_JOIN_PENDING_IDLE_SECONDS)" ]; then \
		worker_args="$$worker_args --pending-idle-seconds $(AGENT_JOIN_PENDING_IDLE_SECONDS)"; \
	fi; \
	if [ -n "$(LIVE_WORKER_MAX_CONCURRENCY)" ]; then \
		worker_args="$$worker_args --max-concurrency $(LIVE_WORKER_MAX_CONCURRENCY)"; \
	fi; \
	if [ "$(LIVE_WORKER_SKIP_OPENAI)" = "1" ]; then \
		worker_args="$$worker_args --skip-openai-handshake"; \
	fi; \
	cd services/interviewer-agent && PYTHONPATH=. uv run --python "$(PYTHON_VERSION)" --with-requirements requirements.txt python -u -m app.auto_worker \
		--redis-url "$$redis_url" \
		--realtime-api-url "$$realtime_api_url" \
		$$worker_args

live-smoke-report: ## Print a replayability report for a live interview SESSION_ID.
	@test -n "$(SESSION_ID)" || (printf "SESSION_ID is required. Example: make live-smoke-report SESSION_ID=is_xxx REALTIME_API_URL=http://127.0.0.1:8080\n"; exit 1)
	@$(LOAD_ENV); \
	realtime_api_url="$${REALTIME_API_URL:-$(LIVE_SMOKE_REALTIME_API_URL)}"; \
	if [ -n "$(REALTIME_API_URL)" ]; then \
		realtime_api_url="$(REALTIME_API_URL)"; \
	fi; \
	node scripts/live-smoke-report.mjs \
		--session-id "$(SESSION_ID)" \
		--realtime-api-url "$$realtime_api_url"

live-smoke-report-strict: ## Fail if a live interview SESSION_ID has lifecycle anomalies.
	@test -n "$(SESSION_ID)" || (printf "SESSION_ID is required. Example: make live-smoke-report-strict SESSION_ID=is_xxx REALTIME_API_URL=http://127.0.0.1:8080\n"; exit 1)
	@$(LOAD_ENV); \
	realtime_api_url="$${REALTIME_API_URL:-$(LIVE_SMOKE_REALTIME_API_URL)}"; \
	if [ -n "$(REALTIME_API_URL)" ]; then \
		realtime_api_url="$(REALTIME_API_URL)"; \
	fi; \
	node scripts/live-smoke-report.mjs \
		--strict \
		--session-id "$(SESSION_ID)" \
		--realtime-api-url "$$realtime_api_url"

e2e-smoke: env-up ## Create a repeatable V1 E2E smoke dataset with mocked LLM by default.
	@$(LOAD_ENV); \
	database_url="$${DATABASE_URL:-$(DATABASE_URL)}"; \
	if [ "$(origin DATABASE_URL)" = "command line" ] || [ "$(origin DATABASE_URL)" = "environment" ]; then \
		database_url="$(DATABASE_URL)"; \
	fi; \
	args="--strict --console-url $(E2E_SMOKE_CONSOLE_URL)"; \
	if [ -n "$(E2E_SMOKE_RUN_ID)" ]; then \
		args="$$args --run-id $(E2E_SMOKE_RUN_ID)"; \
	fi; \
	if [ "$(E2E_SMOKE_RESET)" = "1" ]; then \
		args="$$args --reset"; \
	fi; \
	if [ "$(E2E_SMOKE_LIVE_LLM)" = "1" ]; then \
		args="$$args --live-llm"; \
	fi; \
	DATABASE_URL="$$database_url" node scripts/e2e-smoke.mjs $$args

e2e-smoke-live: ## Run the E2E smoke in explicit live-LLM mode; requires ALLOW_LIVE_LLM_TESTS=1.
	@test "$(ALLOW_LIVE_LLM_TESTS)" = "1" || (printf "Set ALLOW_LIVE_LLM_TESTS=1 to acknowledge paid live LLM smoke mode.\n"; exit 1)
	@$(MAKE) e2e-smoke E2E_SMOKE_LIVE_LLM=1 ALLOW_LIVE_LLM_TESTS=1

e2e-voice-smoke: ## Drive a full live interview as a synthetic candidate (TTS pocket=local/free default, openai gated). Requires a running realtime API + autoworker.
	@if [ "$(VOICE_SMOKE_TTS)" = "openai" ] && [ "$(ALLOW_LIVE_LLM_TESTS)" != "1" ]; then \
		printf "Set ALLOW_LIVE_LLM_TESTS=1 to acknowledge paid OpenAI TTS (or use the default VOICE_SMOKE_TTS=pocket).\n"; \
		exit 1; \
	fi
	@$(LOAD_ENV); \
	realtime_api_url="$${REALTIME_API_URL:-$(LIVE_SMOKE_REALTIME_API_URL)}"; \
	if [ -n "$(REALTIME_API_URL)" ]; then \
		realtime_api_url="$(REALTIME_API_URL)"; \
	fi; \
	database_url="$${DATABASE_URL:-$(DATABASE_URL)}"; \
	if [ "$(origin DATABASE_URL)" = "command line" ] || [ "$(origin DATABASE_URL)" = "environment" ]; then \
		database_url="$(DATABASE_URL)"; \
	fi; \
	harness_args="--tts $(VOICE_SMOKE_TTS) --interview-plan-id $(VOICE_SMOKE_INTERVIEW_PLAN_ID) --realtime-api-url $$realtime_api_url --database-url $$database_url --max-seconds $(VOICE_SMOKE_MAX_SECONDS)"; \
	if [ -n "$(VOICE_SMOKE_VOICE)" ]; then \
		harness_args="$$harness_args --voice $(VOICE_SMOKE_VOICE)"; \
	fi; \
	uv_with="--with-requirements requirements.txt"; \
	if [ "$(VOICE_SMOKE_TTS)" = "pocket" ]; then \
		uv_with="$$uv_with --with pocket-tts==2.1.0"; \
	fi; \
	cd services/interviewer-agent && PYTHONPATH=. uv run --python $(VOICE_SMOKE_PYTHON) $$uv_with python -m app.synthetic_candidate $$harness_args

dev: env-up ## Start local infrastructure, then run the app dev stack.
	@$(LOAD_ENV); pnpm dev
