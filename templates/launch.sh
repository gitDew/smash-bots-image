#!/bin/sh
# Manual Apple Silicon launcher. No desktop changes, builds, or shell-loaded secrets.
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$ROOT"
TEAM=__TEAM__
ACTION=${1:-start}
case "$ACTION" in setup|start|stop|logs|check) ;; *) printf '%s\n' 'Usage: sh launch.sh [setup|start|stop|logs|check]' >&2; exit 2 ;; esac
command -v docker >/dev/null 2>&1 || { printf '%s\n' 'Install Docker Desktop first.' >&2; exit 1; }
ENGINE=$(docker info --format '{{.OSType}}/{{.Architecture}}' 2>/dev/null) || {
  printf '%s\n' 'Start Docker Desktop, then run the launcher again.' >&2; exit 1;
}
case "$ENGINE" in linux/arm64|linux/aarch64) ;; *) printf '%s\n' 'This folder requires Apple Silicon with Docker Linux containers.' >&2; exit 1 ;; esac
VERSION=$(docker compose version --short)
VERSION=${VERSION#v}
MAJOR=${VERSION%%.*}
REST=${VERSION#*.}
MINOR=${REST%%.*}
case "$MAJOR:$MINOR" in *[!0-9:]*|:*) printf '%s\n' 'Cannot determine Docker Compose version.' >&2; exit 1 ;; esac
if [ "$MAJOR" -lt 2 ] || { [ "$MAJOR" -eq 2 ] && [ "$MINOR" -lt 30 ]; }; then
  printf '%s\n' 'Update Docker Desktop: Compose 2.30+ is required.' >&2; exit 1
fi
[ -f credentials.env ] || { printf '%s\n' 'Missing credentials.env. Ask the organizer for the complete team folder.' >&2; exit 1; }
compose() { docker compose --env-file "$ROOT/runtime.env" --file "$ROOT/compose.yaml" --project-name "smash-$TEAM" "$@"; }
compose config --quiet
case "$ACTION" in
  setup)
    chmod 600 credentials.env
    compose pull
    compose up -d --no-build --pull never --wait --wait-timeout 180 broker validator
    printf '%s\n' 'Setup ready. Run: sh launch.sh'
    ;;
  start)
    compose up -d --no-build --pull never --wait --wait-timeout 180 broker validator
    compose run --rm --no-deps --pull never agent
    ;;
  stop) compose down ;;
  logs) compose logs broker validator ;;
  check) printf '%s\n' 'Team folder, Docker architecture, and Compose configuration are valid.' ;;
esac
