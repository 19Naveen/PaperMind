.PHONY: help \
	backend-run backend-test backend-lint backend-fmt backend-typecheck backend-migrate backend-install \
	frontend-dev frontend-build frontend-lint frontend-typecheck frontend-install \
	db-up db-down

help:
	@echo "backend:  install run test lint fmt typecheck migrate"
	@echo "frontend: install dev build lint typecheck"
	@echo "db:       up down"

# ---- backend (uv) ----
backend-install:
	cd backend && uv sync

backend-run:
	cd backend && uv run uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

backend-test:
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
	docker compose down
