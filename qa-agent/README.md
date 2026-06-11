# Vantage QA Agent

## How to Use

### After every code change:
```bash
cd ~/projects/vantage/qa-agent
bash push-and-test.sh
```

This pushes to master and sends a QA report to Telegram within ~2 minutes.

### Run tests only (no push):
```bash
npm run qa
```

### View test report in browser:
```bash
npm run report
```

### Run with browser visible (debugging):
```bash
npm run test:headed
```

## What Gets Tested
- All 5 tabs load without errors
- Portfolio shows correct 10 positions
- Account value is calculated correctly
- Order history has correct data and dates
- AI tab components are visible
- Quick action buttons are accessible
- Screenshots sent on failure

## Files
- `tests/vantage.spec.ts` — Playwright test suite
- `qa-agent.ts` — Visual QA + Telegram reporter
- `playwright.config.ts` — Playwright configuration
- `checklists/` — Phase-specific check items
- `screenshots/` — Auto-saved on each run
- `results/` — JSON + HTML test reports
- `logs/` — Background run logs

## Setup
1. Fill in `.env` with real credentials
2. `npm install`
3. `npx playwright install chromium`
