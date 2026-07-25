#!/usr/bin/env bash
# Disable the GitHub Actions cron workflow (keeps the file for reference).
# Run AFTER confirming QStash is delivering successfully.
set -e

WORKFLOW=".github/workflows/execute-pending-orders.yml"

if [ ! -f "$WORKFLOW" ]; then
  echo "❌ $WORKFLOW not found"
  exit 1
fi

# Rename with .disabled suffix so GitHub ignores it
mv "$WORKFLOW" "${WORKFLOW}.disabled"
echo "✅ Disabled: $WORKFLOW → ${WORKFLOW}.disabled"
echo ""
echo "To re-enable: mv ${WORKFLOW}.disabled $WORKFLOW"
echo ""
echo "Commit this change and push to deploy."
