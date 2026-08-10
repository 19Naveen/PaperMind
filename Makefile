.PHONY: help \
	backend-run backend-test backend-lint backend-fmt backend-typecheck backend-migrate backend-install \
	frontend-dev frontend-build frontend-lint frontend-typecheck frontend-install \
	db-up db-down db-test-up db-test-down

help:
	@echo "backend:  install run test lint fmt typecheck migrate"
	@echo "frontend: install dev build lint typecheck"
	@echo "db:       up down            dev postgres on 5432"
	@echo "db-test:  up down            test postgres on 5433 (backend-test starts it)"

# ---- backend (uv) ----
backend-install:
	cd backend && uv sync

backend-run: db-up
	cd backend && uv run uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

backend-test: db-test-up
	cd backend && uv run pytest -v --cov=app --cov-fail-under=80 tests/

backend-lint:
	cd backend && uv run ruff check . --fix && uv run ruff format .

backend-typecheck:
	cd backend && uv run mypy app

backend-migrate:
	cd backend && uv run alembic upgrade head

# ---- frontend (npm) ----
frontend-install:
	cd web && npm ci

frontend-dev:
	cd web && npm run dev

frontend-build:
	cd web && npm run build

frontend-lint:
	cd web && npm run lint

frontend-typecheck:
	cd web && npx tsc --noEmit

# ---- infra ----
db-up:
	docker compose up -d db

db-down:
	docker compose stop db

db-test-up:
	docker compose up -d --wait db-test

db-test-down:
	docker compose stop db-test
