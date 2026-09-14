#!/usr/bin/env bash
# Runs the integration test suite against a real `next start` instance pointed at an
# isolated, disposable test database — never production. Intended to be run locally or in
# CI, not as part of the deployed app.
set -euo pipefail
cd "$(dirname "$0")/.."

: "${TEST_DATABASE_URL:?Set TEST_DATABASE_URL to a disposable Postgres database, e.g. postgres://postgres:test@localhost:5432/clp_test}"
export AUTH_SECRET="${AUTH_SECRET:-$(node -e 'console.log(require("crypto").randomBytes(32).toString("base64"))')}"
export DATABASE_URL="$TEST_DATABASE_URL"
export NODE_ENV=production
PORT="${TEST_PORT:-3944}"
export TEST_BASE_URL="http://localhost:$PORT"

echo "→ Provisioning schema via scripts/setup.mjs (also exercises that script itself)..."
SUPERADMIN_EMAIL="bootstrap-$$@test.local" SUPERADMIN_PASSWORD="Bootstrap-Password-123!" node scripts/setup.mjs

echo "→ Building..."
npm run build

echo "→ Starting server on $PORT against $TEST_DATABASE_URL ..."
npm start -- -p "$PORT" > /tmp/clp-test-server.log 2>&1 &
SERVER_PID=$!
trap 'kill $SERVER_PID 2>/dev/null || true' EXIT

for i in $(seq 1 30); do
  if curl -s -o /dev/null "$TEST_BASE_URL/login"; then break; fi
  sleep 0.5
done

echo "→ Running integration tests..."
npx tsx --test tests/integration.test.ts
