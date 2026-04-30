#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WORKER_DIR="$ROOT_DIR/cloudflare-worker"

SERVICE_ACCOUNT_JSON="${SERVICE_ACCOUNT_JSON:-}"
GOOGLE_WALLET_ISSUER_ID="${GOOGLE_WALLET_ISSUER_ID:-}"
GOOGLE_WALLET_CLASS_SUFFIX="${GOOGLE_WALLET_CLASS_SUFFIX:-runpass.parkrun}"
GOOGLE_WALLET_ALLOWED_ORIGINS="${GOOGLE_WALLET_ALLOWED_ORIGINS:-getrunpass.com,www.getrunpass.com,localhost:8080}"
GOOGLE_WALLET_FRONTEND_URL="${GOOGLE_WALLET_FRONTEND_URL:-https://getrunpass.com}"
WRANGLER_ENV="${WRANGLER_ENV:-}"
WRANGLER_CMD=""

if [[ -z "$SERVICE_ACCOUNT_JSON" ]]; then
  echo "Set SERVICE_ACCOUNT_JSON to your Google service account key JSON path." >&2
  exit 1
fi

if [[ -z "$GOOGLE_WALLET_ISSUER_ID" ]]; then
  echo "Set GOOGLE_WALLET_ISSUER_ID (numeric issuer ID from Google Pay & Wallet Console)." >&2
  exit 1
fi

if [[ ! -f "$SERVICE_ACCOUNT_JSON" ]]; then
  echo "Service account JSON not found: $SERVICE_ACCOUNT_JSON" >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required." >&2
  exit 1
fi

if ! command -v npx >/dev/null 2>&1; then
  echo "npx is required." >&2
  exit 1
fi

if [[ -x "$WORKER_DIR/node_modules/.bin/wrangler" ]]; then
  WRANGLER_CMD="$WORKER_DIR/node_modules/.bin/wrangler"
else
  WRANGLER_CMD="npx -y @cloudflare/wrangler@1"
fi

SERVICE_ACCOUNT_EMAIL="$(
  node -e "const fs=require('fs');const j=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));process.stdout.write(j.client_email||'')" \
    "$SERVICE_ACCOUNT_JSON"
)"

SERVICE_ACCOUNT_PRIVATE_KEY="$(
  node -e "const fs=require('fs');const j=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));process.stdout.write(j.private_key||'')" \
    "$SERVICE_ACCOUNT_JSON"
)"

if [[ -z "$SERVICE_ACCOUNT_EMAIL" || -z "$SERVICE_ACCOUNT_PRIVATE_KEY" ]]; then
  echo "Unable to read client_email/private_key from $SERVICE_ACCOUNT_JSON" >&2
  exit 1
fi

GOOGLE_WALLET_CLASS_ID="${GOOGLE_WALLET_ISSUER_ID}.${GOOGLE_WALLET_CLASS_SUFFIX}"

wrangler_secret_put() {
  local name="$1"
  local value="$2"
  if [[ -n "$WRANGLER_ENV" ]]; then
    printf '%s' "$value" | (cd "$WORKER_DIR" && eval "$WRANGLER_CMD secret put \"$name\" --env \"$WRANGLER_ENV\"")
  else
    printf '%s' "$value" | (cd "$WORKER_DIR" && eval "$WRANGLER_CMD secret put \"$name\"")
  fi
}

echo "Uploading Google Wallet secrets to Cloudflare Worker..."
echo "Using Wrangler command: $WRANGLER_CMD"
wrangler_secret_put "GOOGLE_WALLET_SERVICE_ACCOUNT_EMAIL" "$SERVICE_ACCOUNT_EMAIL"
wrangler_secret_put "GOOGLE_WALLET_SERVICE_ACCOUNT_PRIVATE_KEY" "$SERVICE_ACCOUNT_PRIVATE_KEY"
wrangler_secret_put "GOOGLE_WALLET_CLASS_ID" "$GOOGLE_WALLET_CLASS_ID"
wrangler_secret_put "GOOGLE_WALLET_ALLOWED_ORIGINS" "$GOOGLE_WALLET_ALLOWED_ORIGINS"
wrangler_secret_put "GOOGLE_WALLET_FRONTEND_URL" "$GOOGLE_WALLET_FRONTEND_URL"

cat <<EOF

Done.

Uploaded secrets:
- GOOGLE_WALLET_SERVICE_ACCOUNT_EMAIL
- GOOGLE_WALLET_SERVICE_ACCOUNT_PRIVATE_KEY
- GOOGLE_WALLET_CLASS_ID ($GOOGLE_WALLET_CLASS_ID)
- GOOGLE_WALLET_ALLOWED_ORIGINS ($GOOGLE_WALLET_ALLOWED_ORIGINS)
- GOOGLE_WALLET_FRONTEND_URL ($GOOGLE_WALLET_FRONTEND_URL)

If you use Wrangler environments, set WRANGLER_ENV (example: production) before running.
EOF
