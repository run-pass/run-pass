# https://getrunpass.com/

Frontend and backend for https://getrunpass.com/

This app lets you create Apple Wallet and Google Wallet passes with your parkrun barcode.

## Google Wallet worker secrets

Set these Cloudflare Worker secrets to enable `/google-wallet`:

- `GW_ISSUER_ID`
- `GW_CLASS_ID` (either full `issuer.class` or class suffix)
- `GW_SERVICE_ACCOUNT_EMAIL`
- `GW_PRIVATE_KEY` (Google service account private key)
- `GW_ORIGINS` (comma-separated domain list, e.g. `getrunpass.com`)

[![publish cloudflare worker](https://github.com/run-pass/run-pass/actions/workflows/worker-publish.yml/badge.svg)](https://github.com/run-pass/run-pass/actions/workflows/worker-publish.yml)
