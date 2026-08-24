#!/usr/bin/env bash
# ─── Verify QStash cron schedules ────────────────────────────
# Lists all registered Upstash QStash schedules and checks that the
# four expected Vantage schedules exist and are NOT paused.
#
# Usage:
#   QSTASH_TOKEN=xxx ./scripts/verify-qstash.sh
#   (falls back to the token baked into scripts/setup-qstash-order-sync.ts)
#
# Expected schedules:
#   sync-orders              */5  13-21 * * 1-5   (order fill/cancel sync)
#   execute-pending-orders   */5  13-21 * * 1-5   (demo fill/expiry)
#   portfolio-agent          */30 13-21 * * 1-5   (Noticed AI engine)
#   agent-digest             15   21   * * *       (daily email digest)
set -euo pipefail

BASE_URL="${QSTASH_BASE_URL:-https://qstash-us-east-1.upstash.io}"
TOKEN="${QSTASH_TOKEN:-eyJVc2VySUQiOiJiNDI1YjgyYS1jYjVhLTRlNzQtYTMwNC0yMWYxMGFlYzQ1ZTQiLCJQYXNzd29yZCI6IjZlZTZhY2IyYzYxZDRiMDM4YTQwOWQwZDE3NDIzYTM4In0=}"

EXPECTED=(sync-orders execute-pending-orders portfolio-agent agent-digest)

RESP="$(curl -s -H "Authorization: Bearer ${TOKEN}" "${BASE_URL}/v2/schedules")"

if ! command -v jq >/dev/null 2>&1; then
  echo "❌ jq is required (apt install jq)."
  exit 1
fi

if ! echo "$RESP" | jq -e 'type == "array"' >/dev/null 2>&1; then
  echo "❌ Failed to list schedules (bad token?):"
  echo "$RESP" | head -c 400
  exit 1
fi

echo "QStash schedules (${BASE_URL}):"
echo "----------------------------------------"
echo "$RESP" | jq -r '.[] | "\(.scheduleId)  \(.cron)  paused=\(.isPaused)  → \(.destination)"'

echo
echo "Expected-schedule check:"
FAIL=0
for id in "${EXPECTED[@]}"; do
  if echo "$RESP" | jq -e --arg id "$id" '.[] | select(.scheduleId == $id)' >/dev/null 2>&1; then
    PAUSED=$(echo "$RESP" | jq -r --arg id "$id" '.[] | select(.scheduleId == $id) | .isPaused')
    NEXT=$(echo "$RESP" | jq -r --arg id "$id" '.[] | select(.scheduleId == $id) | .nextScheduleTime')
    NEXT_ISO=$(date -u -d "@$((NEXT/1000))" '+%Y-%m-%d %H:%M:%S UTC' 2>/dev/null || echo "n/a")
    STATE=$(echo "$RESP" | jq -r --arg id "$id" '.[] | select(.scheduleId == $id) | (.lastScheduleStates // {} | to_entries[0].value // "n/a")')
    if [ "$PAUSED" = "true" ]; then
      echo "⚠️  $id — PAUSED"
      FAIL=1
    else
      echo "✅ $id — active · next ${NEXT_ISO} · last ${STATE:-n/a}"
    fi
  else
    echo "❌ $id — NOT REGISTERED"
    FAIL=1
  fi
done

echo
if [ "$FAIL" = "0" ]; then
  echo "✅ All expected schedules present and unpaused."
else
  echo "⚠️  One or more schedules missing/paused — run the matching scripts/setup-qstash*.ts."
fi
