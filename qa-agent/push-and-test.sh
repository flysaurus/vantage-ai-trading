#!/bin/bash
# Use this instead of plain 'git push origin master'
# It pushes and automatically triggers QA

set -e
cd ~/projects/vantage

echo "📦 Pushing to master..."
git push origin master

echo "🔍 Triggering QA in background..."
nohup ~/projects/vantage/qa-agent/post-deploy.sh > \
  ~/projects/vantage/qa-agent/logs/qa-$(date +%Y%m%d-%H%M%S).log \
  2>&1 &

echo "✅ Push complete. QA running in background."
echo "   Results will arrive via Telegram in ~2 minutes."
