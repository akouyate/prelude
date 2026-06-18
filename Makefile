SHELL := /bin/sh

COMPOSE ?= docker compose
POSTGRES_PORT ?= 5432
DATABASE_URL ?= postgresql://postgres:postgres@localhost:$(POSTGRES_PORT)/prelude?schema=public
MIGRATION_NAME ?= init
LOAD_ENV := set -a; [ ! -f .env ] || . ./.env; set +a
BENCHMARK_PROVIDER ?= mock_openai_realtime
BENCHMARK_SCENARIO ?= normal
BENCHMARK_ITERATIONS ?= 3
BENCHMARK_RUN_ID ?=
BENCHMARK_PERSIST_REALTIME ?=
REALTIME_API_URL ?=
SESSION_ID ?=
LIVE_WORKER_SKIP_OPENAI ?=
LIVE_WORKER_MAX_DURATION_SECONDS ?=

.DEFAULT_GOAL := help

.PHONY: help env-up env-down env-reset db-logs db-shell db-migrate db-generate db-studio agent-benchmark live-openai-worker dev

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

env-down: ## Stop local Docker services without deleting volumes.
	$(COMPOSE) down

env-reset: ## Stop local Docker services and delete local volumes.
	$(COMPOSE) down --volumes --remove-orphans

db-logs: ## Follow local Postgres logs.
	$(COMPOSE) logs -f postgres

db-shell: ## Open a psql shell inside the local Postgres container.
	$(COMPOSE) exec postgres psql -U postgres -d prelude

db-migrate: ## Run Prisma migrations against local Postgres.
	@$(LOAD_ENV); DATABASE_URL="$${DATABASE_URL:-$(DATABASE_URL)}" pnpm --filter @prelude/db exec prisma migrate dev --schema prisma/schema.prisma --name "$(MIGRATION_NAME)"

db-generate: ## Regenerate the Prisma client.
	@$(LOAD_ENV); DATABASE_URL="$${DATABASE_URL:-$(DATABASE_URL)}" pnpm --filter @prelude/db db:generate

db-studio: ## Open Prisma Studio against local Postgres.
	@$(LOAD_ENV); DATABASE_URL="$${DATABASE_URL:-$(DATABASE_URL)}" pnpm --filter @prelude/db exec prisma studio --schema prisma/schema.prisma

agent-benchmark: ## Run the Python live IA provider benchmark harness.
	@$(LOAD_ENV); \
	realtime_args=""; \
	if [ "$(BENCHMARK_PERSIST_REALTIME)" = "1" ] && [ -n "$${REALTIME_API_URL:-}" ]; then \
		realtime_args="--realtime-api-url $$REALTIME_API_URL"; \
		if [ -n "$${REALTIME_API_KEY:-}" ]; then \
			realtime_args="$$realtime_args --api-key $$REALTIME_API_KEY"; \
		fi; \
	fi; \
	cd services/interviewer-agent && uv run --with-requirements requirements.txt python -m app.benchmark_cli \
		--provider "$(BENCHMARK_PROVIDER)" \
		--scenario "$(BENCHMARK_SCENARIO)" \
		--iterations "$(BENCHMARK_ITERATIONS)" \
		$(if $(BENCHMARK_RUN_ID),--benchmark-run-id "$(BENCHMARK_RUN_ID)") \
		$$realtime_args

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
	cd services/interviewer-agent && uv run --with-requirements requirements.txt python -m app.live_worker \
		--session-id "$(SESSION_ID)" \
		--realtime-api-url "$$realtime_api_url" \
		$$worker_args

dev: env-up ## Start local infrastructure, then run the app dev stack.
	@$(LOAD_ENV); pnpm dev
