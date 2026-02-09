# https://getrunpass.com/

Frontend and backend for https://getrunpass.com/

This app lets you create passbooks for your iPhone with your parkrun barcode.

## Rotate Apple signing key

Use the helper script to rotate worker signing secrets from a new `.p12` file:

```bash
scripts/rotate-apple-signer.sh \
  --p12 /path/to/new-cert.p12 \
  --key-passphrase 'new-signer-key-passphrase' \
  --trigger-deploy
```

Fully non-interactive (useful for ops runbooks):

```bash
scripts/rotate-apple-signer.sh \
  --p12 /path/to/new-cert.p12 \
  --p12-password "$P12_PASSWORD" \
  --generate-key-passphrase \
  --no-prompt \
  --trigger-deploy
```

What it does:

- Extracts cert + key from the `.p12`
- Validates the cert and key match
- Updates GitHub repo secrets:
  - `SIGNER_CERT`
  - `SIGNER_KEY`
  - `SIGNER_KEY_PASSPHRASE`
- Optionally triggers `worker-publish.yml`

Prerequisites:

- `gh` CLI authenticated with repo admin rights
- `openssl`

There is also a health-check workflow at `.github/workflows/apple-signing-health.yml` that runs weekly and on-demand to verify secret validity and expiry threshold.
If the check becomes unhealthy, it automatically opens or updates a repo issue titled `Rotate Apple pass signing certificate`.

[![publish cloudflare worker](https://github.com/run-pass/run-pass/actions/workflows/worker-publish.yml/badge.svg)](https://github.com/run-pass/run-pass/actions/workflows/worker-publish.yml)
