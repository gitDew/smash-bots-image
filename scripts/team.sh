#!/bin/sh
set -eu

TEAM=${1:-team_a}
case "$TEAM" in
  team_a|team_b|team_c|team_d) ;;
  *) printf '%s\n' 'Usage: scripts/team.sh team_a|team_b|team_c|team_d [env-file]' >&2; exit 2 ;;
esac
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$ROOT"
export ENV_FILE=${2:-.env}
export EVENT_TEAM_ID=$TEAM
PROJECT="smash-$TEAM"

# Prerequisite: Docker Desktop/Engine running; images built/preloaded once.
docker compose --env-file "$ENV_FILE" --project-name "$PROJECT" up -d --wait broker validator
docker compose --env-file "$ENV_FILE" --project-name "$PROJECT" run --rm --no-deps agent
