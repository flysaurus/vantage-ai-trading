#!/bin/bash
# Kill any running QA agent or Playwright processes
pkill -f "ts-node qa-agent.ts" 2>/dev/null && echo "Killed ts-node qa-agent"
pkill -f "playwright" 2>/dev/null && echo "Killed playwright"
sleep 1
exit 0
