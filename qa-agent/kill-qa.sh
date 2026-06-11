#!/bin/bash
echo "Stopping QA agent..."
pkill -f "ts-node qa-agent" || true
pkill -f "playwright" || true
pkill -f "post-deploy.sh" || true
rm -f /tmp/vantage-qa.lock
rm -f /tmp/vantage-qa-lastrun
echo "QA agent stopped. Lock files cleared."
