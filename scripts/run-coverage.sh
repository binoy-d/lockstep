#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET="${1:-all}"

run_backend() {
  echo "==> Backend coverage (relevant files)"
  npm --prefix "$ROOT_DIR/backend" run coverage
}

run_web() {
  echo "==> Web coverage (relevant files)"
  npm --prefix "$ROOT_DIR/web" run coverage:relevant
}

case "$TARGET" in
  all)
    run_backend
    run_web
    ;;
  backend)
    run_backend
    ;;
  web)
    run_web
    ;;
  *)
    echo "Usage: scripts/run-coverage.sh [all|backend|web]"
    exit 1
    ;;
esac
