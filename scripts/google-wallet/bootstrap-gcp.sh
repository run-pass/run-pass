#!/usr/bin/env bash
set -euo pipefail

if ! command -v gcloud >/dev/null 2>&1; then
  echo "gcloud CLI is required." >&2
  exit 1
fi

PROJECT_ID="${PROJECT_ID:-}"
SERVICE_ACCOUNT_ID="${SERVICE_ACCOUNT_ID:-runpass-google-wallet}"
KEY_OUT="${KEY_OUT:-}"

if [[ -z "$PROJECT_ID" ]]; then
  echo "Set PROJECT_ID (example: export PROJECT_ID=my-gcp-project)." >&2
  exit 1
fi

if [[ -z "$KEY_OUT" ]]; then
  echo "Set KEY_OUT to where the service account key JSON should be written." >&2
  echo "Example: export KEY_OUT=$HOME/.config/runpass/google-wallet-service-account.json" >&2
  exit 1
fi

if [[ -e "$KEY_OUT" ]]; then
  echo "Refusing to overwrite existing file: $KEY_OUT" >&2
  exit 1
fi

mkdir -p "$(dirname "$KEY_OUT")"

SERVICE_ACCOUNT_EMAIL="${SERVICE_ACCOUNT_ID}@${PROJECT_ID}.iam.gserviceaccount.com"

echo "Enabling Google Wallet Objects API in project $PROJECT_ID..."
gcloud services enable walletobjects.googleapis.com --project "$PROJECT_ID"

if ! gcloud iam service-accounts describe "$SERVICE_ACCOUNT_EMAIL" --project "$PROJECT_ID" >/dev/null 2>&1; then
  echo "Creating service account $SERVICE_ACCOUNT_EMAIL..."
  gcloud iam service-accounts create "$SERVICE_ACCOUNT_ID" \
    --display-name="run-pass Google Wallet" \
    --project "$PROJECT_ID"
else
  echo "Service account already exists: $SERVICE_ACCOUNT_EMAIL"
fi

echo "Creating service account key JSON at $KEY_OUT..."
gcloud iam service-accounts keys create "$KEY_OUT" \
  --iam-account "$SERVICE_ACCOUNT_EMAIL" \
  --project "$PROJECT_ID"

cat <<EOF

Done.

Next manual step (cannot be fully scripted):
1. In Google Pay & Wallet Console, add this service account to your Wallet issuer as a developer/admin.

Then continue with:
1. npm ci --prefix scripts/google-wallet
2. scripts/google-wallet/upsert-class.mjs (create/update the Generic class)
3. scripts/google-wallet/set-wrangler-secrets.sh (upload Worker secrets)

Service account email:
  $SERVICE_ACCOUNT_EMAIL

Key file:
  $KEY_OUT
EOF
