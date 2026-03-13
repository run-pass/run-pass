#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"

PASSBOOK_URL="${PASSBOOK_URL:-https://prod-api.getrunpass.com/passbook}"
BARCODE="${BARCODE:-A1234567}"
WWDR_CERT_PATH="${WWDR_CERT_PATH:-$REPO_ROOT/cloudflare-worker/src/assets/wwdr.pem}"
APPLE_ROOT_CA_PATH="${APPLE_ROOT_CA_PATH:-$REPO_ROOT/cloudflare-worker/src/assets/apple-root-ca.pem}"

usage() {
  cat <<EOF
Usage: $(basename "$0") [--url URL] [--barcode BARCODE]

Checks the production Apple Wallet pass endpoint by validating:
- HTTP 200
- Content-Type application/vnd.apple.pkpass
- Valid pkpass archive with pass.json, manifest.json, and signature
- manifest.json entries exactly match archive payload files and SHA1 hashes
- pass.json includes valid identifiers, formatVersion, serialNumber, and barcode payload
- signer certificate UID/OU match pass.json passTypeIdentifier/teamIdentifier
- detached PKCS#7 signature over manifest.json
- signer certificate chains through WWDR to Apple Root CA
- signer certificate is currently within its validity window

Environment overrides:
  PASSBOOK_URL
  BARCODE
  WWDR_CERT_PATH
  APPLE_ROOT_CA_PATH
EOF
}

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || fail "required command not found: $1"
}

require_file() {
  [[ -f "$1" ]] || fail "required file not found: $1"
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

split_certificate_bundle() {
  local bundle_file="$1"
  local output_dir="$2"

  awk -v dir="$output_dir" '
    /-----BEGIN CERTIFICATE-----/ { in_cert = 1; file = sprintf("%s/cert-%02d.pem", dir, ++count) }
    in_cert { print >> file }
    /-----END CERTIFICATE-----/ { in_cert = 0; close(file) }
  ' "$bundle_file"
}

validate_archive_and_payload() {
  local pkpass_file="$1"
  local pass_json_file="$2"
  local manifest_file="$3"
  local signature_file="$4"
  local expected_barcode="$5"

  python3 - "$pkpass_file" "$pass_json_file" "$manifest_file" "$signature_file" "$expected_barcode" <<'PY'
import hashlib
import json
import sys
import zipfile

pkpass_path, pass_json_path, manifest_path, signature_path, expected_barcode = sys.argv[1:6]

required_files = {"pass.json", "manifest.json", "signature"}

try:
    with zipfile.ZipFile(pkpass_path) as zf:
        archive_files = [info.filename for info in zf.infolist() if not info.is_dir()]
        archive_file_set = set(archive_files)
        missing_required = sorted(required_files - archive_file_set)
        if missing_required:
            raise SystemExit(f"pkpass archive is missing {', '.join(missing_required)}")

        pass_json_bytes = zf.read("pass.json")
        manifest_bytes = zf.read("manifest.json")
        signature_bytes = zf.read("signature")

        with open(pass_json_path, "wb") as fh:
            fh.write(pass_json_bytes)
        with open(manifest_path, "wb") as fh:
            fh.write(manifest_bytes)
        with open(signature_path, "wb") as fh:
            fh.write(signature_bytes)

        manifest = json.loads(manifest_bytes)
        if not isinstance(manifest, dict):
            raise SystemExit("manifest.json is not a JSON object")

        payload_files = sorted(
            name for name in archive_files if name not in {"manifest.json", "signature"}
        )
        manifest_files = sorted(manifest.keys())

        if set(manifest_files) != set(payload_files):
            details = []
            extra_manifest = sorted(set(manifest_files) - set(payload_files))
            extra_payload = sorted(set(payload_files) - set(manifest_files))
            if extra_manifest:
                details.append(
                    "manifest references missing files: " + ", ".join(extra_manifest)
                )
            if extra_payload:
                details.append(
                    "archive payload files missing from manifest: " + ", ".join(extra_payload)
                )
            raise SystemExit("; ".join(details))

        for filename, expected_sha1 in manifest.items():
            if not isinstance(expected_sha1, str) or len(expected_sha1) != 40:
                raise SystemExit(f"manifest.json has invalid SHA1 entry for {filename}")
            actual_sha1 = hashlib.sha1(zf.read(filename)).hexdigest()
            if actual_sha1 != expected_sha1:
                raise SystemExit(
                    f"manifest SHA1 mismatch for {filename}: expected {expected_sha1}, got {actual_sha1}"
                )

        payload = json.loads(pass_json_bytes)
        pass_type_identifier = payload.get("passTypeIdentifier") or ""
        team_identifier = payload.get("teamIdentifier") or ""
        format_version = payload.get("formatVersion")
        serial_number = payload.get("serialNumber")
        barcodes = payload.get("barcodes")

        if not pass_type_identifier:
            raise SystemExit("pass.json is missing passTypeIdentifier")
        if not team_identifier:
            raise SystemExit("pass.json is missing teamIdentifier")
        if format_version != 1:
            raise SystemExit(f"pass.json formatVersion must be 1, got {format_version!r}")
        if not isinstance(serial_number, str) or not serial_number.strip():
            raise SystemExit("pass.json is missing serialNumber")

        barcode_messages = []
        if isinstance(barcodes, list):
            for barcode in barcodes:
                if isinstance(barcode, dict):
                    barcode_messages.append(barcode.get("message"))

        if expected_barcode not in barcode_messages:
            raise SystemExit(
                f"pass.json barcodes do not include requested barcode {expected_barcode}"
            )

        print(f"{pass_type_identifier}\t{team_identifier}")
except zipfile.BadZipFile:
    raise SystemExit("response is not a valid .pkpass archive")
PY
}

extract_signer_certificate() {
  local cert_dir="$1"
  local signer_cert=""
  local cert_file

  shopt -s nullglob
  for cert_file in "$cert_dir"/cert-*.pem; do
    if [[ -n "$(extract_subject_field "$cert_file" "UID")" ]]; then
      signer_cert="$cert_file"
      break
    fi
  done
  shopt -u nullglob

  [[ -n "$signer_cert" ]] || fail "could not find signer certificate in pass signature"
  printf '%s\n' "$signer_cert"
}

verify_detached_signature() {
  local signature_file="$1"
  local manifest_file="$2"

  openssl smime -verify -inform DER -in "$signature_file" -content "$manifest_file" -noverify >/dev/null 2>&1 ||
    fail "signature does not verify manifest.json"
}

verify_signer_chain() {
  local signer_cert="$1"

  openssl verify -purpose any -CAfile "$APPLE_ROOT_CA_PATH" -untrusted "$WWDR_CERT_PATH" "$signer_cert" >/dev/null 2>&1 ||
    fail "signer certificate does not chain to Apple Root CA via WWDR"
}

check_validity_window_from_dates() {
  local not_before="$1"
  local not_after="$2"
  local current_epoch="${3:-}"

  python3 - "$not_before" "$not_after" "$current_epoch" <<'PY'
from datetime import datetime, timezone
import sys

not_before, not_after, current_epoch = sys.argv[1:4]

def parse_utc(value: str) -> datetime:
    normalized = " ".join(value.split())
    return datetime.strptime(normalized, "%b %d %H:%M:%S %Y GMT").replace(tzinfo=timezone.utc)

start = parse_utc(not_before)
end = parse_utc(not_after)
now = (
    datetime.fromtimestamp(int(current_epoch), tz=timezone.utc)
    if current_epoch
    else datetime.now(timezone.utc)
)

if now < start:
    print(f"FAIL: signer certificate is not valid until {not_before}", file=sys.stderr)
    raise SystemExit(1)
if now > end:
    print(f"FAIL: signer certificate expired on {not_after}", file=sys.stderr)
    raise SystemExit(1)
PY
}

check_signer_certificate_validity() {
  local signer_cert="$1"
  local not_before
  local not_after

  not_before="$(openssl x509 -in "$signer_cert" -noout -startdate | sed 's/^notBefore=//')"
  not_after="$(openssl x509 -in "$signer_cert" -noout -enddate | sed 's/^notAfter=//')"

  [[ -n "$not_before" ]] || fail "could not read signer certificate notBefore date"
  [[ -n "$not_after" ]] || fail "could not read signer certificate notAfter date"

  check_validity_window_from_dates "$not_before" "$not_after"
}

main() {
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
  require_file "$WWDR_CERT_PATH"
  require_file "$APPLE_ROOT_CA_PATH"

  local tmpdir headers_file pkpass_file pass_json_file manifest_file signature_file certs_file cert_dir
  local request_url status_code content_type payload_output payload_status pass_type_identifier team_identifier signer_cert signer_uid signer_ou

  tmpdir="$(mktemp -d)"
  cleanup() {
    if [[ -n "${tmpdir:-}" ]]; then
      rm -rf "$tmpdir"
    fi
  }
  trap cleanup EXIT

  headers_file="$tmpdir/headers.txt"
  pkpass_file="$tmpdir/pass.pkpass"
  pass_json_file="$tmpdir/pass.json"
  manifest_file="$tmpdir/manifest.json"
  signature_file="$tmpdir/signature.der"
  certs_file="$tmpdir/certs.pem"
  cert_dir="$tmpdir/certs"
  mkdir -p "$cert_dir"

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

  set +e
  payload_output="$(
    validate_archive_and_payload "$pkpass_file" "$pass_json_file" "$manifest_file" "$signature_file" "$BARCODE" 2>&1
  )"
  payload_status=$?
  set -e

  [[ "$payload_status" -eq 0 ]] || fail "$payload_output"
  IFS=$'\t' read -r pass_type_identifier team_identifier <<< "$payload_output"

  openssl pkcs7 -inform DER -in "$signature_file" -print_certs -out "$certs_file" >/dev/null 2>&1 ||
    fail "signature is not a valid PKCS#7 certificate bundle"
  split_certificate_bundle "$certs_file" "$cert_dir"

  signer_cert="$(extract_signer_certificate "$cert_dir")"
  signer_uid="$(extract_subject_field "$signer_cert" "UID")"
  signer_ou="$(extract_subject_field "$signer_cert" "OU")"

  [[ -n "$signer_uid" ]] || fail "signer certificate is missing UID"
  [[ -n "$signer_ou" ]] || fail "signer certificate is missing OU"
  [[ "$signer_uid" == "$pass_type_identifier" ]] ||
    fail "passTypeIdentifier/signer UID mismatch: pass.json has $pass_type_identifier, signer cert has $signer_uid"
  [[ "$signer_ou" == "$team_identifier" ]] ||
    fail "teamIdentifier/signer OU mismatch: pass.json has $team_identifier, signer cert has $signer_ou"

  verify_detached_signature "$signature_file" "$manifest_file"
  verify_signer_chain "$signer_cert"
  check_signer_certificate_validity "$signer_cert"

  echo "PASS: Apple Wallet production endpoint returned a valid signed pkpass"
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi
