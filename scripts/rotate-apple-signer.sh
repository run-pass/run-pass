#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Rotate Apple pass signing secrets used by the Cloudflare worker.

Usage:
  scripts/rotate-apple-signer.sh --p12 /path/to/cert.p12 [options]

Options:
  --p12 <path>               Path to the Apple signing .p12 file (required)
  --p12-password <value>     Password for the .p12 file (or set P12_PASSWORD)
  --key-passphrase <value>   Passphrase to encrypt SIGNER_KEY (or set KEY_PASSPHRASE)
  --generate-key-passphrase  Generate a random SIGNER_KEY_PASSPHRASE
  --no-prompt                Fail instead of prompting for missing values
  --repo <owner/repo>        GitHub repo slug (default: derived from git remote)
  --trigger-deploy           Trigger worker-publish workflow after rotating secrets
  --deploy-ref <ref>         Ref for workflow dispatch (default: main)
  -h, --help                 Show this help

Examples:
  scripts/rotate-apple-signer.sh \
    --p12 ~/Downloads/pass-cert.p12 \
    --key-passphrase 'new-passphrase'

  scripts/rotate-apple-signer.sh \
    --p12 ~/Downloads/pass-cert.p12 \
    --key-passphrase 'new-passphrase' \
    --trigger-deploy

  scripts/rotate-apple-signer.sh \
    --p12 ~/Downloads/pass-cert.p12 \
    --p12-password "$P12_PASSWORD" \
    --generate-key-passphrase \
    --no-prompt \
    --trigger-deploy
USAGE
}

fail() {
  echo "ERROR: $*" >&2
  exit 1
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || fail "Missing required command: $1"
}

derive_repo_from_git_remote() {
  local remote_url
  local slug
  remote_url="$(git remote get-url origin 2>/dev/null || true)"

  if [[ "$remote_url" =~ ^git@github\.com:([^/]+/[^/]+)(\.git)?$ ]]; then
    slug="${BASH_REMATCH[1]}"
    echo "${slug%.git}"
    return
  fi

  if [[ "$remote_url" =~ ^https://github\.com/([^/]+/[^/]+)(\.git)?$ ]]; then
    slug="${BASH_REMATCH[1]}"
    echo "${slug%.git}"
    return
  fi

  fail "Could not derive --repo from git remote. Pass --repo owner/repo explicitly."
}

P12_PATH=""
P12_PASSWORD="${P12_PASSWORD:-}"
KEY_PASSPHRASE="${KEY_PASSPHRASE:-}"
REPO=""
TRIGGER_DEPLOY=0
DEPLOY_REF="main"
GENERATE_KEY_PASSPHRASE=0
NO_PROMPT=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --p12)
      [[ $# -ge 2 ]] || fail "--p12 requires a value"
      P12_PATH="$2"
      shift 2
      ;;
    --p12-password)
      [[ $# -ge 2 ]] || fail "--p12-password requires a value"
      P12_PASSWORD="$2"
      shift 2
      ;;
    --key-passphrase)
      [[ $# -ge 2 ]] || fail "--key-passphrase requires a value"
      KEY_PASSPHRASE="$2"
      shift 2
      ;;
    --generate-key-passphrase)
      GENERATE_KEY_PASSPHRASE=1
      shift
      ;;
    --no-prompt)
      NO_PROMPT=1
      shift
      ;;
    --repo)
      [[ $# -ge 2 ]] || fail "--repo requires a value"
      REPO="$2"
      shift 2
      ;;
    --trigger-deploy)
      TRIGGER_DEPLOY=1
      shift
      ;;
    --deploy-ref)
      [[ $# -ge 2 ]] || fail "--deploy-ref requires a value"
      DEPLOY_REF="$2"
      shift 2
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

require_cmd gh
require_cmd openssl
require_cmd awk
require_cmd git

[[ -n "$P12_PATH" ]] || fail "--p12 is required"
[[ -f "$P12_PATH" ]] || fail "p12 file not found: $P12_PATH"

if [[ -z "$P12_PASSWORD" ]]; then
  if [[ "$NO_PROMPT" -eq 1 ]]; then
    fail "p12 password is required in --no-prompt mode"
  fi
  read -r -s -p "Enter .p12 password: " P12_PASSWORD
  echo
fi

if [[ -z "$KEY_PASSPHRASE" ]]; then
  if [[ "$GENERATE_KEY_PASSPHRASE" -eq 1 ]]; then
    KEY_PASSPHRASE="$(openssl rand -hex 32)"
    echo "Generated random SIGNER_KEY_PASSPHRASE"
  elif [[ "$NO_PROMPT" -eq 1 ]]; then
    fail "SIGNER_KEY_PASSPHRASE is required in --no-prompt mode"
  else
    read -r -s -p "Enter SIGNER_KEY_PASSPHRASE to store: " KEY_PASSPHRASE
    echo
  fi
fi

[[ -n "$P12_PASSWORD" ]] || fail "p12 password is required"
[[ -n "$KEY_PASSPHRASE" ]] || fail "SIGNER_KEY_PASSPHRASE is required"

if [[ -z "$REPO" ]]; then
  REPO="$(derive_repo_from_git_remote)"
fi

# Validate gh auth early before touching key material.
gh auth status >/dev/null

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

cert_file="$tmp_dir/signer-cert.pem"
key_file="$tmp_dir/signer-key.pem"

openssl pkcs12 -in "$P12_PATH" -clcerts -nokeys -passin "pass:${P12_PASSWORD}" 2>/dev/null \
  | awk '/-----BEGIN CERTIFICATE-----/{flag=1} flag{print} /-----END CERTIFICATE-----/{if(flag){exit}}' \
  > "$cert_file"

[[ -s "$cert_file" ]] || fail "Could not extract certificate from p12"

openssl pkcs12 -in "$P12_PATH" -nocerts -nodes -passin "pass:${P12_PASSWORD}" 2>/dev/null \
  | openssl pkey -aes256 -passout "pass:${KEY_PASSPHRASE}" 2>/dev/null \
  > "$key_file"

[[ -s "$key_file" ]] || fail "Could not extract key from p12"

openssl pkey -in "$key_file" -passin "pass:${KEY_PASSPHRASE}" -noout >/dev/null 2>&1 \
  || fail "Extracted key cannot be decrypted with provided key passphrase"

cert_pub_sha="$(openssl x509 -in "$cert_file" -pubkey -noout \
  | openssl pkey -pubin -outform der \
  | openssl dgst -sha256 \
  | awk '{print $2}')"

key_pub_sha="$(openssl pkey -in "$key_file" -passin "pass:${KEY_PASSPHRASE}" -pubout -outform der \
  | openssl dgst -sha256 \
  | awk '{print $2}')"

[[ "$cert_pub_sha" == "$key_pub_sha" ]] || fail "Extracted cert/key do not match"

cert_subject="$(openssl x509 -in "$cert_file" -noout -subject | sed 's/^subject=//')"
cert_expiry="$(openssl x509 -in "$cert_file" -noout -enddate | cut -d= -f2-)"

echo "Rotating secrets in $REPO"
echo "Certificate subject: $cert_subject"
echo "Certificate expiry:  $cert_expiry"

gh secret set SIGNER_CERT --repo "$REPO" < "$cert_file"
gh secret set SIGNER_KEY --repo "$REPO" < "$key_file"
gh secret set SIGNER_KEY_PASSPHRASE --repo "$REPO" --body "$KEY_PASSPHRASE"

echo "Updated repository secrets: SIGNER_CERT, SIGNER_KEY, SIGNER_KEY_PASSPHRASE"

if [[ "$TRIGGER_DEPLOY" -eq 1 ]]; then
  gh workflow run worker-publish.yml --repo "$REPO" --ref "$DEPLOY_REF"
  echo "Triggered workflow_dispatch for worker-publish.yml on ref $DEPLOY_REF"
else
  echo "No deploy triggered. Run this to deploy now:"
  echo "  gh workflow run worker-publish.yml --repo $REPO --ref $DEPLOY_REF"
fi
