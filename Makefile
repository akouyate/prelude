SHELL := /bin/sh

COMPOSE ?= docker compose
POSTGRES_PORT ?= 5432
DATABASE_URL ?= postgresql://postgres:postgres@localhost:$(POSTGRES_PORT)/prelude?schema=public
MIGRATION_NAME ?= init

.DEFAULT_GOAL := help

.PHONY: help env-up env-down env-reset db-logs db-shell db-migrate db-generate db-studio dev

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
	DATABASE_URL="$(DATABASE_URL)" pnpm --filter @prelude/db exec prisma migrate dev --schema prisma/schema.prisma --name "$(MIGRATION_NAME)"

db-generate: ## Regenerate the Prisma client.
	DATABASE_URL="$(DATABASE_URL)" pnpm --filter @prelude/db db:generate

db-studio: ## Open Prisma Studio against local Postgres.
	DATABASE_URL="$(DATABASE_URL)" pnpm --filter @prelude/db exec prisma studio --schema prisma/schema.prisma

dev: env-up ## Start local infrastructure, then run the app dev stack.
	pnpm dev
