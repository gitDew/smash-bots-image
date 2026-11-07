TEAM ?= team_a
PROJECT ?= smash-$(TEAM)
ENV_FILE ?= .env
PYTHON ?= python3
EVENT_CONFIG ?= .env.event
RELEASE_FILE ?= release.json
export ENV_FILE
export EVENT_TEAM_ID = $(TEAM)
COMPOSE = docker compose --env-file $(ENV_FILE) --project-name $(PROJECT)

.PHONY: build run up down logs check-config test smoke init-event check-event check-model bundles

# Building never needs real credentials, even before .env exists.
build:
	ENV_FILE=.env.example docker compose --env-file .env.example --project-name $(PROJECT) build

up:
	$(COMPOSE) up -d --wait broker validator

run: up
	$(COMPOSE) run --rm --no-deps agent

down:
	$(COMPOSE) down

logs:
	$(COMPOSE) logs broker validator

# Do not print interpolated configuration: it contains broker secrets.
check-config:
	$(COMPOSE) config --quiet

test:
	npm ci --ignore-scripts --no-audit --no-fund
	npm test
	$(PYTHON) -m unittest discover -s tests -p 'test_*.py'

smoke:
	./tests/container-smoke.sh

# Administrator-only preparation. Never prints or exports event credentials.
init-event:
	node scripts/init-event.mjs

check-event:
	npm run build
	node scripts/bundles.mjs check --config $(EVENT_CONFIG)

# Explicit LIVE Azure call. Never part of builds/CI; uses up to two inference requests.
check-model:
	npm run build
	node scripts/check-model.mjs --config $(EVENT_CONFIG)

bundles:
	npm run build
	node scripts/bundles.mjs generate --config $(EVENT_CONFIG) --release $(RELEASE_FILE)
