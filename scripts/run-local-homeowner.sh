#!/usr/bin/env bash
# Local FastQuote with the West Yorkshire homeowner flow enabled.
# Requires PostgreSQL (DATABASE_URL). Default below matches the cloud
# agent local DB created for this work.
set -euo pipefail
cd "$(dirname "$0")/.."

export DATABASE_URL="${DATABASE_URL:-postgresql://fastquote:fastquote@127.0.0.1:5432/fastquote}"
export HOMEOWNER_QUOTES_ENABLED=true
export HOMEOWNER_NOTIFY_USER_IDS="${HOMEOWNER_NOTIFY_USER_IDS:-mark}"
export SESSION_SECRET="${SESSION_SECRET:-local-dev-session-secret}"
export NODE_ENV="${NODE_ENV:-development}"
export PORT="${PORT:-3000}"
export PUBLIC_BASE_URL="${PUBLIC_BASE_URL:-http://127.0.0.1:${PORT}}"

echo "Starting FastQuote on :${PORT}"
echo "  HOMEOWNER_QUOTES_ENABLED=${HOMEOWNER_QUOTES_ENABLED}"
echo "  HOMEOWNER_NOTIFY_USER_IDS=${HOMEOWNER_NOTIFY_USER_IDS}"
echo "  Open http://127.0.0.1:${PORT}/quote"
echo "  Admin: legacy-switch to mark/harry, then Enquiries in the side rail"

exec node server.js
