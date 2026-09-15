#!/usr/bin/env bash
# Runs the integration suite against a real `next start` instance backed by an
# isolated, disposable Postgres database — never production.
#
# Schema provisioning happens HERE (CLI), never from the running app.
set -euo pipefail
cd "$(dirname "$0")/.."

: "${TEST_DATABASE_URL:?Set TEST_DATABASE_URL to a disposable Postgres database}"
export DATABASE_URL="$TEST_DATABASE_URL"
export DIRECT_URL="$TEST_DATABASE_URL"
export AUTH_SECRET="${AUTH_SECRET:-$(node -e 'console.log(require("crypto").randomBytes(32).toString("base64"))')}"
export NODE_ENV=production

echo "→ Provisioning schema via scripts/setup.mjs (CLI-only path)…"
SUPERADMIN_EMAIL="owner@example.test" \
SUPERADMIN_PASSWORD="TestOwnerPassw0rd!" \
SUPERADMIN_NAME="Test Owner" \
node scripts/setup.mjs

echo "→ Building…"
npm run build

echo "→ Running integration tests…"
node --test tests/integration.test.mjs
