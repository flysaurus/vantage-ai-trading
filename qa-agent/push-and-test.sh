#!/bin/bash
set -e
cd ~/.openclaw/workspace/projects/vantage

# Check if QA already running
if [ -f /tmp/vantage-qa.lock ]; then
  LOCK_AGE=$(( $(date +%s) - $(stat -c %Y /tmp/vantage-qa.lock 2>/dev/null || echo 0) ))
  if [ $LOCK_AGE -lt 600 ]; then
    echo "⚠️ QA already running (${LOCK_AGE}s ago). Skipping QA trigger."
    git push origin master
    exit 0
  fi
fi

echo "📦 Pushing to master..."
git push origin master

echo "🔍 Triggering QA in background..."
nohup bash ~/.openclaw/workspace/projects/vantage/qa-agent/post-deploy.sh > \
  ~/.openclaw/workspace/projects/vantage/qa-agent/logs/qa-$(date +%Y%m%d-%H%M%S).log \
  2>&1 &

echo "✅ Push complete. QA running in background."
echo "   Results via Telegram in ~2 minutes."
