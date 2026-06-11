#!/bin/bash
# Run this after every push to master
# It waits for Vercel deploy then runs QA

echo "⏳ Waiting ${DEPLOY_WAIT:-90}s for Vercel deploy..."
sleep ${DEPLOY_WAIT:-90}

echo "🔍 Running QA Agent..."
cd ~/projects/vantage/qa-agent
npm run qa
