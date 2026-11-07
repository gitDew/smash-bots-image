#!/bin/sh
# Only the trusted Git subprocess receives GITHUB_TOKEN; never store it in a URL.
case "$1" in
  *Username*) printf '%s\n' 'x-access-token' ;;
  *Password*) printf '%s\n' "$GITHUB_TOKEN" ;;
  *) exit 1 ;;
esac
