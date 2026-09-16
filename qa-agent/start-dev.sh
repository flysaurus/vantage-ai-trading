#!/usr/bin/env bash
# Start the Vantage dev server WITH the live broker credentials.
# .env.local alone lacks SNAPTRADE_CLIENT_ID/CONSUMER_KEY + VAULT_ENCRYPTION_KEY
# (those live in .env.reconcile.local) — without them every live broker route
# 500s: /api/broker/status, /api/accounts, and the account fetch never fires.
set -a
cd /root/projects/vantage
. ./.env.reconcile.local
. ./.env.local
set +a
exec npx next dev -p "${PORT:-3002}"
