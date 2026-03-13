#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

# shellcheck source=./check-apple-passbook.sh
source "$SCRIPT_DIR/check-apple-passbook.sh"

assert_success() {
  "$@" >/dev/null 2>&1 || {
    echo "FAIL: expected success from $*" >&2
    exit 1
  }
}

assert_failure() {
  local expected_fragment="$1"
  shift

  set +e
  local output
  output="$("$@" 2>&1)"
  local status=$?
  set -e

  if [[ "$status" -eq 0 ]]; then
    echo "FAIL: expected failure from $*" >&2
    exit 1
  fi

  if [[ "$output" != *"$expected_fragment"* ]]; then
    echo "FAIL: expected failure containing '$expected_fragment' but got: $output" >&2
    exit 1
  fi
}

CURRENT_EPOCH=1735689600

assert_success check_validity_window_from_dates \
  "Jan  1 00:00:00 2024 GMT" \
  "Jan  1 00:00:00 2026 GMT" \
  "$CURRENT_EPOCH"

assert_failure "signer certificate expired on" check_validity_window_from_dates \
  "Jan  1 00:00:00 2020 GMT" \
  "Jan  1 00:00:00 2024 GMT" \
  "$CURRENT_EPOCH"

assert_failure "signer certificate is not valid until" check_validity_window_from_dates \
  "Jan  1 00:00:00 2026 GMT" \
  "Jan  1 00:00:00 2027 GMT" \
  "$CURRENT_EPOCH"

echo "PASS: certificate validity helper checks behave as expected"
