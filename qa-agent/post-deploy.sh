#!/bin/bash
# Run this after every push to master
# It waits for Vercel deploy then runs QA

# Vercel can take up to 2 minutes for cold deploys
DEPLOY_WAIT_SECONDS=${DEPLOY_WAIT_SECONDS:-120}
echo "⏳ Waiting ${DEPLOY_WAIT_SECONDS}s for Vercel deploy..."
sleep ${DEPLOY_WAIT_SECONDS}

echo "🔍 Running QA Agent..."
cd ~/.openclaw/workspace/projects/vantage/qa-agent
npm run qa
