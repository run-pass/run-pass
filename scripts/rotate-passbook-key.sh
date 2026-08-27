#!/usr/bin/env bash

set -euo pipefail

umask 077

SCRIPT_NAME="$(basename "$0")"
WORKFLOW_FILE="worker-publish.yml"
REPO=""
P12_PATH=""
KEEP_DIR=""
TRIGGER_WORKFLOW=0
DRY_RUN=0
SYNC_IDENTIFIERS=1

usage() {
  cat <<EOF
Usage: $SCRIPT_NAME --p12 /path/to/pass-signing.p12 [options]

Rotates the Apple Wallet/Passbook signing secrets used by this repo by:
1. Extracting a PEM certificate and encrypted PEM private key from a .p12
2. Validating the cert and private key match
3. Deriving PASS_TYPE_IDENTIFIER and TEAM_IDENTIFIER from the certificate subject
4. Uploading GitHub Actions secrets
5. Optionally triggering the deploy workflow

Options:
  --p12 PATH              Path to the exported Apple pass signing .p12 (required)
  --repo OWNER/REPO       GitHub repo for secrets/workflow (default: inferred from git remote)
  --workflow FILE         Workflow file/name to trigger (default: $WORKFLOW_FILE)
  --trigger-workflow      Trigger the worker deploy workflow after uploading secrets
  --keep-dir DIR          Copy generated PEM files into DIR (0600 perms). Default: temp only
  --no-sync-identifiers   Do not update PASS_TYPE_IDENTIFIER and TEAM_IDENTIFIER
  --dry-run               Generate + validate only; do not call GitHub CLI
  -h, --help              Show this help

Environment variables (optional):
  P12_PASSWORD            Password for importing the .p12 (prompted if unset)
  KEY_PASSPHRASE          Password to encrypt the exported signer key and store in GitHub secret

Examples:
  $SCRIPT_NAME --p12 ~/Downloads/pass-signing.p12 --repo run-pass/run-pass
  $SCRIPT_NAME --p12 ~/Downloads/pass-signing.p12 --trigger-workflow
EOF
}

fail() {
  echo "Error: $*" >&2
  exit 1
}

have_cmd() {
  command -v "$1" >/dev/null 2>&1
}

infer_repo_from_git() {
  local remote_url
  if ! remote_url="$(git config --get remote.origin.url 2>/dev/null)"; then
    return 1
  fi

  case "$remote_url" in
    git@github.com:*)
      remote_url="${remote_url#git@github.com:}"
      remote_url="${remote_url%.git}"
      printf '%s\n' "$remote_url"
      ;;
    https://github.com/*)
      remote_url="${remote_url#https://github.com/}"
      remote_url="${remote_url%.git}"
      printf '%s\n' "$remote_url"
      ;;
    *)
      return 1
      ;;
  esac
}

prompt_secret() {
  local var_name="$1"
  local prompt="$2"
  if [[ -z "${!var_name:-}" ]]; then
    local value
    read -r -s -p "$prompt: " value
    echo
    printf -v "$var_name" '%s' "$value"
  fi
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --p12)
        [[ $# -ge 2 ]] || fail "--p12 requires a path"
        P12_PATH="$2"
        shift 2
        ;;
      --repo)
        [[ $# -ge 2 ]] || fail "--repo requires OWNER/REPO"
        REPO="$2"
        shift 2
        ;;
      --workflow)
        [[ $# -ge 2 ]] || fail "--workflow requires a file/name"
        WORKFLOW_FILE="$2"
        shift 2
        ;;
      --trigger-workflow)
        TRIGGER_WORKFLOW=1
        shift
        ;;
      --keep-dir)
        [[ $# -ge 2 ]] || fail "--keep-dir requires a directory path"
        KEEP_DIR="$2"
        shift 2
        ;;
      --no-sync-identifiers)
        SYNC_IDENTIFIERS=0
        shift
        ;;
      --dry-run)
        DRY_RUN=1
        shift
        ;;
      -h|--help)
        usage
        exit 0
        ;;
      *)
        fail "Unknown argument: $1"
        ;;
    esac
  done

  [[ -n "$P12_PATH" ]] || fail "--p12 is required (use --help for usage)"
}

print_cert_summary() {
  local cert_file="$1"
  echo "Certificate summary:"
  openssl x509 -in "$cert_file" -noout -subject -issuer -enddate -fingerprint -sha256
}

get_cert_field() {
  local cert_file="$1"
  local field_name="$2"
  local subject

  subject="$(openssl x509 -in "$cert_file" -noout -subject -nameopt RFC2253)"
  subject="${subject#subject=}"
  printf '%s\n' "$subject" | tr ',' '\n' | sed -n "s/^${field_name}=//p" | head -n 1
}

validate_pair() {
  local cert_file="$1"
  local key_file="$2"
  local key_passphrase="$3"
  local tmpdir="$4"

  openssl x509 -in "$cert_file" -pubkey -noout >"$tmpdir/cert.pub.pem"
  openssl pkey -in "$key_file" -passin "pass:$key_passphrase" -pubout >"$tmpdir/key.pub.pem"

  if ! cmp -s "$tmpdir/cert.pub.pem" "$tmpdir/key.pub.pem"; then
    fail "Extracted certificate and private key do not match"
  fi
}

write_github_secret_from_file() {
  local repo="$1"
  local secret_name="$2"
  local secret_file="$3"
  gh secret set "$secret_name" --repo "$repo" <"$secret_file"
}

write_github_secret_from_stdin_value() {
  local repo="$1"
  local secret_name="$2"
  local value="$3"
  local tmp_file="$4"

  printf '%s' "$value" >"$tmp_file"
  gh secret set "$secret_name" --repo "$repo" <"$tmp_file"
}

main() {
  parse_args "$@"

  have_cmd openssl || fail "openssl is required"

  [[ -f "$P12_PATH" ]] || fail ".p12 file not found: $P12_PATH"

  if [[ -z "$REPO" ]]; then
    if REPO="$(infer_repo_from_git)"; then
      :
    else
      fail "Could not infer GitHub repo from git remote. Use --repo OWNER/REPO"
    fi
  fi

  if [[ "$DRY_RUN" -eq 0 ]]; then
    have_cmd gh || fail "gh (GitHub CLI) is required unless --dry-run is used"
    gh auth status >/dev/null 2>&1 || fail "GitHub CLI is not authenticated. Run: gh auth login"
  fi

  prompt_secret P12_PASSWORD "Enter .p12 import password"
  prompt_secret KEY_PASSPHRASE "Enter passphrase for exported signer key (stored as SIGNER_KEY_PASSPHRASE)"

  local tmpdir cert_file key_file key_pass_file pass_type_identifier team_identifier
  tmpdir="$(mktemp -d)"
  cert_file="$tmpdir/signer-cert.pem"
  key_file="$tmpdir/signer-key.pem"
  key_pass_file="$tmpdir/signer-key-passphrase.txt"

  cleanup() {
    if [[ -n "${tmpdir:-}" ]]; then
      rm -rf "$tmpdir"
    fi
  }
  trap cleanup EXIT

  echo "Extracting signing certificate and encrypted private key..."
  openssl pkcs12 \
    -in "$P12_PATH" \
    -clcerts \
    -nokeys \
    -out "$cert_file" \
    -passin "pass:$P12_PASSWORD"

  openssl pkcs12 \
    -in "$P12_PATH" \
    -nocerts \
    -out "$key_file" \
    -passin "pass:$P12_PASSWORD" \
    -passout "pass:$KEY_PASSPHRASE"

  echo "Validating cert/key pair..."
  validate_pair "$cert_file" "$key_file" "$KEY_PASSPHRASE" "$tmpdir"
  print_cert_summary "$cert_file"

  if [[ "$SYNC_IDENTIFIERS" -eq 1 ]]; then
    pass_type_identifier="$(get_cert_field "$cert_file" "UID")"
    team_identifier="$(get_cert_field "$cert_file" "OU")"

    [[ -n "$pass_type_identifier" ]] || fail "Could not derive PASS_TYPE_IDENTIFIER from certificate subject"
    [[ -n "$team_identifier" ]] || fail "Could not derive TEAM_IDENTIFIER from certificate subject"

    echo "Derived identifiers:"
    echo "  PASS_TYPE_IDENTIFIER=$pass_type_identifier"
    echo "  TEAM_IDENTIFIER=$team_identifier"
  fi

  if [[ -n "$KEEP_DIR" ]]; then
    mkdir -p "$KEEP_DIR"
    cp "$cert_file" "$KEEP_DIR/signer-cert.pem"
    cp "$key_file" "$KEEP_DIR/signer-key.pem"
    chmod 600 "$KEEP_DIR/signer-cert.pem" "$KEEP_DIR/signer-key.pem"
    echo "Saved PEM artifacts to: $KEEP_DIR"
  fi

  if [[ "$DRY_RUN" -eq 1 ]]; then
    echo
    echo "Dry run complete. No GitHub secrets were updated."
    return 0
  fi

  echo "Uploading GitHub Actions secrets to $REPO..."
  write_github_secret_from_file "$REPO" "SIGNER_CERT" "$cert_file"
  write_github_secret_from_file "$REPO" "SIGNER_KEY" "$key_file"
  write_github_secret_from_stdin_value "$REPO" "SIGNER_KEY_PASSPHRASE" "$KEY_PASSPHRASE" "$key_pass_file"
  if [[ "$SYNC_IDENTIFIERS" -eq 1 ]]; then
    write_github_secret_from_stdin_value "$REPO" "PASS_TYPE_IDENTIFIER" "$pass_type_identifier" "$tmpdir/pass-type-identifier.txt"
    write_github_secret_from_stdin_value "$REPO" "TEAM_IDENTIFIER" "$team_identifier" "$tmpdir/team-identifier.txt"
    echo "Updated secrets: SIGNER_CERT, SIGNER_KEY, SIGNER_KEY_PASSPHRASE, PASS_TYPE_IDENTIFIER, TEAM_IDENTIFIER"
  else
    echo "Updated secrets: SIGNER_CERT, SIGNER_KEY, SIGNER_KEY_PASSPHRASE"
  fi

  if [[ "$TRIGGER_WORKFLOW" -eq 1 ]]; then
    echo "Triggering workflow: $WORKFLOW_FILE"
    gh workflow run "$WORKFLOW_FILE" --repo "$REPO"
    echo "Workflow dispatched. Use 'gh run list --repo $REPO --workflow $WORKFLOW_FILE' to check status."
  fi
}

main "$@"
