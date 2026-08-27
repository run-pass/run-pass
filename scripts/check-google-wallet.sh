#!/usr/bin/env bash

set -euo pipefail

GOOGLE_WALLET_URL="${GOOGLE_WALLET_URL:-https://prod-api.getrunpass.com/google-wallet}"
BARCODE="${BARCODE:-A1234567}"
EXPECTED_LOCATION_PREFIX="https://pay.google.com/gp/v/save/"

usage() {
  cat <<EOF
Usage: $(basename "$0") [--url URL] [--barcode BARCODE]

Checks the production Google Wallet endpoint by validating:
- HTTP 302
- Location header points at the Google Wallet save URL

Environment overrides:
  GOOGLE_WALLET_URL
  BARCODE
EOF
}

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || fail "required command not found: $1"
}

main() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --url)
        [[ $# -ge 2 ]] || fail "--url requires a value"
        GOOGLE_WALLET_URL="$2"
        shift 2
        ;;
      --barcode)
        [[ $# -ge 2 ]] || fail "--barcode requires a value"
        BARCODE="$2"
        shift 2
        ;;
      -h|--help)
        usage
        exit 0
        ;;
      *)
        fail "unknown argument: $1"
        ;;
    esac
  done

  require_cmd curl

  local tmpdir headers_file body_file request_url status_code location

  tmpdir="$(mktemp -d)"
  cleanup() {
    if [[ -n "${tmpdir:-}" ]]; then
      rm -rf "$tmpdir"
    fi
  }
  trap cleanup EXIT

  headers_file="$tmpdir/headers.txt"
  body_file="$tmpdir/body.txt"

  request_url="$GOOGLE_WALLET_URL"
  if [[ "$request_url" == *\?* ]]; then
    request_url="${request_url}&barcode=${BARCODE}"
  else
    request_url="${request_url}?barcode=${BARCODE}"
  fi

  status_code="$(
    curl -sS -D "$headers_file" -o "$body_file" -w '%{http_code}' "$request_url"
  )"

  [[ "$status_code" == "302" ]] || {
    local body
    body="$(tr -d '\r' < "$body_file")"
    fail "expected HTTP 302 from $request_url, got $status_code${body:+: $body}"
  }

  location="$(
    tr -d '\r' < "$headers_file" |
      awk 'tolower($1) == "location:" { sub(/^[^:]+:[[:space:]]*/, "", $0); print; exit }'
  )"

  [[ -n "$location" ]] || fail "response did not include a Location header"
  [[ "$location" == "$EXPECTED_LOCATION_PREFIX"* ]] ||
    fail "expected Location to start with $EXPECTED_LOCATION_PREFIX, got $location"

  echo "PASS: Google Wallet production endpoint returned a Google save redirect"
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi
