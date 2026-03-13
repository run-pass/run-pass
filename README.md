# https://getrunpass.com/

Frontend and backend for https://getrunpass.com/

This app lets you create passbooks for your iPhone with your parkrun barcode.

[![publish cloudflare worker](https://github.com/run-pass/run-pass/actions/workflows/worker-publish.yml/badge.svg)](https://github.com/run-pass/run-pass/actions/workflows/worker-publish.yml)
[![monitor prod apple passbook](https://github.com/run-pass/run-pass/actions/workflows/prod-monitor.yml/badge.svg)](https://github.com/run-pass/run-pass/actions/workflows/prod-monitor.yml)

A daily GitHub Actions monitor checks the production Apple Wallet pass endpoint at 07:00 UTC and relies on native workflow failure notifications.
