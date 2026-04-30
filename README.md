# https://getrunpass.com/

Frontend and backend for https://getrunpass.com/

This app lets you create wallet passes for your parkrun barcode:
- Apple Wallet (`.pkpass`) for iPhone
- Google Wallet (`savetowallet` link) for Android

## parkrun course route scrape

`scripts/scrape-parkrun-course-routes.mjs` enriches parkrun events with route metadata from the Google My Maps embeds on each event's course page. It fetches `https://images.parkrun.com/events.json`, builds course page URLs from the country domains, extracts the Google My Maps `mid`, downloads the public KML export, and writes JSON with `start`, `finish`, full route coordinates, placemark summaries, and scrape failures.

Examples:

```bash
node scripts/scrape-parkrun-course-routes.mjs --event bushy --output bushy-route.json
node scripts/scrape-parkrun-course-routes.mjs --country 97 --limit 10 --output uk-sample-routes.json
node scripts/scrape-parkrun-course-routes.mjs --mid zj7h2Fr7knm4.kmi-jDrZZSRc --output bushy-route.json
```

## Android / Google Wallet support

The repo now includes:
- Worker endpoint: `/google-wallet` (server-signed Google Wallet JWT redirect)
- Device-aware frontend button: `Add to Google Wallet` for Android once the launch flag is enabled
- Setup scripts for Google Cloud + Wallet class + Wrangler secrets

### What is manual vs scripted

Manual (Google console / policy steps):
1. Create or use a Google Wallet issuer account in Google Pay & Wallet Console.
2. Request publishing access (production approval) if you want to go live.
3. Add your Google Cloud service account to the Wallet issuer in the console.

Scripted (this repo):
1. Create service account key + enable Wallet API (`scripts/google-wallet/bootstrap-gcp.sh`)
2. Create the Google Wallet Generic class if missing (`scripts/google-wallet/upsert-class.mjs`, Node 18+)
3. Upload Cloudflare Worker secrets (`scripts/google-wallet/set-wrangler-secrets.sh`)

### Quick start (Google Wallet)

1. Create the service account + key (scripted)

```bash
export PROJECT_ID="your-gcp-project-id"
export KEY_OUT="$HOME/.config/runpass/google-wallet-service-account.json"
./scripts/google-wallet/bootstrap-gcp.sh
```

2. Add that service account to your Wallet issuer in Google Pay & Wallet Console (manual)

3. Create the Generic class (scripted)

```bash
node ./scripts/google-wallet/upsert-class.mjs \
  --service-account-json "$KEY_OUT" \
  --issuer-id "YOUR_GOOGLE_WALLET_ISSUER_ID" \
  --class-suffix "runpass.parkrun"
```

4. Upload Worker secrets (scripted)

```bash
export SERVICE_ACCOUNT_JSON="$KEY_OUT"
export GOOGLE_WALLET_ISSUER_ID="YOUR_GOOGLE_WALLET_ISSUER_ID"
export GOOGLE_WALLET_CLASS_SUFFIX="runpass.parkrun"
export GOOGLE_WALLET_ALLOWED_ORIGINS="getrunpass.com,www.getrunpass.com,localhost:8080"
export GOOGLE_WALLET_FRONTEND_URL="https://getrunpass.com"
export WRANGLER_ENV="production" # optional
./scripts/google-wallet/set-wrangler-secrets.sh
```

5. Deploy worker/frontend as normal

6. Validate the production redirect

```bash
./scripts/check-google-wallet.sh
```

7. Enable the public frontend launch flag

After issuer approval and a successful Android save test, set `GOOGLE_WALLET_LIVE` to `true` in `frontend/src/app/app.tsx` and deploy the frontend. With the flag enabled:
- Android browsers see only Google Wallet
- iOS browsers see only Apple Wallet
- Desktop/unknown browsers see both wallet options

### Google Wallet secrets used by the Worker

- `GOOGLE_WALLET_SERVICE_ACCOUNT_EMAIL`
- `GOOGLE_WALLET_SERVICE_ACCOUNT_PRIVATE_KEY`
- `GOOGLE_WALLET_CLASS_ID` (format: `<issuerId>.<classSuffix>`)
- `GOOGLE_WALLET_ALLOWED_ORIGINS` (comma-separated hosts, not paths)
- `GOOGLE_WALLET_FRONTEND_URL` (optional, defaults to `https://getrunpass.com`)
- `GOOGLE_WALLET_MONITOR_ENABLED` (`true` enables the scheduled production redirect check)

[![publish cloudflare worker](https://github.com/run-pass/run-pass/actions/workflows/worker-publish.yml/badge.svg)](https://github.com/run-pass/run-pass/actions/workflows/worker-publish.yml)
[![monitor prod apple passbook](https://github.com/run-pass/run-pass/actions/workflows/prod-monitor.yml/badge.svg)](https://github.com/run-pass/run-pass/actions/workflows/prod-monitor.yml)

A daily GitHub Actions monitor checks the production Apple Wallet pass endpoint at 07:00 UTC and relies on native workflow failure notifications.
