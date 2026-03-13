#!/usr/bin/env bash

set -euo pipefail

PASSBOOK_URL="${PASSBOOK_URL:-https://prod-api.getrunpass.com/passbook}"
BARCODE="${BARCODE:-A1234567}"

usage() {
  cat <<EOF
Usage: $(basename "$0") [--url URL] [--barcode BARCODE]

Checks the production Apple Wallet pass endpoint by validating:
- HTTP 200
- Content-Type application/vnd.apple.pkpass
- Valid pkpass archive with pass.json, manifest.json, and signature
- pass.json includes passTypeIdentifier and teamIdentifier
- signer certificate UID/OU match pass.json passTypeIdentifier/teamIdentifier

Environment overrides:
  PASSBOOK_URL
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

extract_subject_field() {
  local cert_file="$1"
  local field_name="$2"
  local subject

  subject="$(openssl x509 -in "$cert_file" -noout -subject -nameopt RFC2253)"
  subject="${subject#subject=}"
  subject="${subject# }"
  printf '%s\n' "$subject" | tr ',' '\n' | sed -n "s/^${field_name}=//p" | head -n 1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --url)
      [[ $# -ge 2 ]] || fail "--url requires a value"
      PASSBOOK_URL="$2"
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
require_cmd unzip
require_cmd openssl
require_cmd python3

tmpdir="$(mktemp -d)"
cleanup() {
  rm -rf "$tmpdir"
}
trap cleanup EXIT

headers_file="$tmpdir/headers.txt"
pkpass_file="$tmpdir/pass.pkpass"
pass_json_file="$tmpdir/pass.json"
manifest_file="$tmpdir/manifest.json"
signature_file="$tmpdir/signature.der"
certs_file="$tmpdir/certs.pem"

request_url="$PASSBOOK_URL"
if [[ "$request_url" == *\?* ]]; then
  request_url="${request_url}&barcode=${BARCODE}"
else
  request_url="${request_url}?barcode=${BARCODE}"
fi

status_code="$(
  curl -sS -L -D "$headers_file" -o "$pkpass_file" -w '%{http_code}' "$request_url"
)"

[[ "$status_code" == "200" ]] || fail "expected HTTP 200 from $request_url, got $status_code"

content_type="$(
  tr -d '\r' < "$headers_file" |
    awk 'tolower($1) == "content-type:" { sub(/^[^:]+:[[:space:]]*/, "", $0); print tolower($0); exit }'
)"
content_type="${content_type%%;*}"
[[ -n "$content_type" ]] || fail "response did not include a Content-Type header"
[[ "$content_type" == "application/vnd.apple.pkpass" ]] || fail "expected Content-Type application/vnd.apple.pkpass, got $content_type"

unzip -tqq "$pkpass_file" >/dev/null 2>&1 || fail "response is not a valid .pkpass archive"
unzip -p "$pkpass_file" pass.json > "$pass_json_file" || fail "pkpass archive is missing pass.json"
unzip -p "$pkpass_file" manifest.json > "$manifest_file" || fail "pkpass archive is missing manifest.json"
unzip -p "$pkpass_file" signature > "$signature_file" || fail "pkpass archive is missing signature"

IFS=$'\t' read -r pass_type_identifier team_identifier < <(
  python3 - "$pass_json_file" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as fh:
    data = json.load(fh)

print(data.get("passTypeIdentifier", ""), data.get("teamIdentifier", ""), sep="\t")
PY
)

[[ -n "$pass_type_identifier" ]] || fail "pass.json is missing passTypeIdentifier"
[[ -n "$team_identifier" ]] || fail "pass.json is missing teamIdentifier"

openssl pkcs7 -inform DER -in "$signature_file" -print_certs -out "$certs_file" >/dev/null 2>&1 ||
  fail "signature is not a valid PKCS#7 certificate bundle"

awk -v dir="$tmpdir" '
  /-----BEGIN CERTIFICATE-----/ { in_cert = 1; file = sprintf("%s/cert-%02d.pem", dir, ++count) }
  in_cert { print >> file }
  /-----END CERTIFICATE-----/ { in_cert = 0; close(file) }
' "$certs_file"

shopt -s nullglob
signer_cert=""
for cert_file in "$tmpdir"/cert-*.pem; do
  if [[ -n "$(extract_subject_field "$cert_file" "UID")" ]]; then
    signer_cert="$cert_file"
    break
  fi
done
shopt -u nullglob

[[ -n "$signer_cert" ]] || fail "could not find signer certificate in pass signature"

signer_uid="$(extract_subject_field "$signer_cert" "UID")"
signer_ou="$(extract_subject_field "$signer_cert" "OU")"

[[ -n "$signer_uid" ]] || fail "signer certificate is missing UID"
[[ -n "$signer_ou" ]] || fail "signer certificate is missing OU"
[[ "$signer_uid" == "$pass_type_identifier" ]] ||
  fail "passTypeIdentifier/signer UID mismatch: pass.json has $pass_type_identifier, signer cert has $signer_uid"
[[ "$signer_ou" == "$team_identifier" ]] ||
  fail "teamIdentifier/signer OU mismatch: pass.json has $team_identifier, signer cert has $signer_ou"

echo "PASS: Apple Wallet production endpoint returned a valid signed pkpass"
