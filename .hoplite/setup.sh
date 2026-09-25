#!/usr/bin/env bash
set -euo pipefail

if ! command -v sqlite3 >/dev/null 2>&1; then
  apt-get update -qq
  apt-get install -y -qq sqlite3
fi

pnpm install --frozen-lockfile
