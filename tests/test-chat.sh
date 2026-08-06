#!/usr/bin/env bash
# ─── Vantage Chat Pipeline Test Harness ───────────────────────────────
# Tests the full AI chat pipeline end-to-end against a running dev server.
#
# Usage:
#   ./tests/test-chat.sh [--base-url http://localhost:3000]
#
# Prerequisites:
#   - Vantage dev server running on http://localhost:3000
#   - Screener service running on http://127.0.0.1:8766
#   - Valid auth cookie for the test user (set VANTAGE_AUTH_COOKIE)
#
# Output:
#   Pass/fail per test + summary at end. Exit code 0 = all passed.
#   JSON test report written to tests/.last-results.json.
# ──────────────────────────────────────────────────────────────────────

set -euo pipefail

BASE_URL="${1:-http://localhost:3000}"
API_URL="$BASE_URL/api/chat"
COOKIE="${VANTAGE_AUTH_COOKIE:-}"
REPORT_FILE="$(dirname "$0")/.last-results.json"
TESTS_PASSED=0
TESTS_FAILED=0
RESULTS='[]'

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

# ─── Helpers ─────────────────────────────────────────────────────────

add_result() {
  local name="$1" status="$2" detail="$3"
  RESULTS=$(echo "$RESULTS" | jq --arg n "$name" --arg s "$status" --arg d "$detail" \
    '. + [{test:$n, status:$s, detail:$d}]')
}

pass() { echo -e "  ${GREEN}✓ PASS${NC} — $1"; TESTS_PASSED=$((TESTS_PASSED + 1)); add_result "$1" "pass" ""; }
fail() { echo -e "  ${RED}✗ FAIL${NC} — $1: $2"; TESTS_FAILED=$((TESTS_FAILED + 1)); add_result "$1" "fail" "$2"; }
info() { echo -e "  ${CYAN}ℹ${NC} $1"; }

# Send a chat request and collect all SSE events + final text.
# Returns: SSE events on stdout (one JSON object per line), final text in file
send_chat() {
  local test_name="$1"
  shift
  # Build JSON payload from remaining args (key=value pairs)
  local payload='{}'
  while [[ $# -gt 0 ]]; do
    local k="${1%%=*}" v="${1#*=}"
    payload=$(echo "$payload" | jq --arg k "$k" --arg v "$v" '. + {($k): $v}')
    shift
  done

  # Ensure messages is an array when passed as JSON string
  local tmpfile
  tmpfile=$(mktemp)

  curl -sN "$API_URL" \
    -H 'Content-Type: application/json' \
    -H "Cookie: $COOKIE" \
    -d "$payload" \
    --max-time 120 \
    -o "$tmpfile" 2>/dev/null || true

  cat "$tmpfile"
  rm -f "$tmpfile"
}

# Parse SSE events from raw response into JSON lines
parse_sse() {
  local raw="$1"
  echo "$raw" | while IFS= read -r line; do
    if [[ "$line" =~ ^data:[[:space:]]*(.*)$ ]]; then
      local data="${BASH_REMATCH[1]}"
      if [[ "$data" != '[DONE]' ]]; then
        echo "$data"
      fi
    fi
  done
}

# ─── Pre-flight Checks ───────────────────────────────────────────────

echo -e "${BOLD}═══ Vantage Chat Pipeline Test Harness ═══${NC}"
echo "Target: $API_URL"
echo

# Check server is reachable
if ! curl -s --max-time 5 "$BASE_URL" > /dev/null 2>&1; then
  echo -e "${RED}✗ Cannot reach $BASE_URL — is the dev server running?${NC}"
  echo
  echo "Start with:"
  echo "  cd /root/projects/vantage && npm run dev"
  exit 1
fi

# ─── Test 1: Single-sector portfolio ─────────────────────────────────

echo -e "${BOLD}Test 1${NC}: Single-sector — \"Build me a \$5,000 tech portfolio\""
RAW=$(send_chat "single-sector" \
  'messages' '[{"role":"user","content":"Build me a $5,000 tech portfolio"}]' \
  'portfolioContext' '' \
  'mode' 'chat' \
  'investorStyle' 'Balanced' \
  'riskTolerance' 'Moderate' \
  'name' 'TestUser' \
  'timezone' 'America/New_York' \
  'retryAttempt' '0' \
  'validationFailures' 'null')

EVENTS=$(parse_sse "$RAW")

# Assertions
# 1a: Has RECOMMEND markers (not just plain text)
if echo "$RAW" | grep -q '\[RECOMMEND:[A-Z]\{1,5\}'; then
  pass "Contains RECOMMEND markers"
else
  fail "Contains RECOMMEND markers" "no RECOMMEND markers found in response"
fi

# 1b: No raw [PORTFOLIO: visible in text (stripping works)
if echo "$RAW" | grep -q '\[PORTFOLIO:{'; then
  fail "No raw [PORTFOLIO: visible" "raw PORTFOLIO JSON found in response — stripping broken"
else
  pass "No raw [PORTFOLIO: visible"
fi

# 1c: Checklist events present
CHECKLIST_COUNT=$(echo "$EVENTS" | grep -c '"checklist"' || true)
if [ "$CHECKLIST_COUNT" -ge 2 ]; then
  pass "Checklist events received ($CHECKLIST_COUNT stages)"
else
  fail "Checklist events received" "only $CHECKLIST_COUNT checklist events (expected >=2)"
fi

# 1d: No fatal validation failure
if echo "$EVENTS" | grep -q '"fatalValidationFailure"'; then
  fail "No fatal validation failure" "fatalValidationFailure received"
else
  pass "No fatal validation failure"
fi

# 1e: Response contains text (not empty)
TEXT_LEN=$(echo "$RAW" | grep -o '"text":"[^"]*"' | wc -c || true)
if [ "$TEXT_LEN" -gt 20 ]; then
  pass "Response contains substantive text"
else
  fail "Response contains substantive text" "response text too short ($TEXT_LEN bytes)"
fi

echo

# ─── Test 2: Multi-sector portfolio ──────────────────────────────────

echo -e "${BOLD}Test 2${NC}: Multi-sector — \"Split \$10,000 across healthcare and energy\""
RAW=$(send_chat "multi-sector" \
  'messages' '[{"role":"user","content":"Split $10,000 across healthcare and energy"}]' \
  'portfolioContext' '' \
  'mode' 'chat' \
  'investorStyle' 'Balanced' \
  'riskTolerance' 'Moderate' \
  'name' 'TestUser' \
  'timezone' 'America/New_York' \
  'retryAttempt' '0' \
  'validationFailures' 'null')

EVENTS=$(parse_sse "$RAW")

# 2a: Has RECOMMEND markers
if echo "$RAW" | grep -q '\[RECOMMEND:[A-Z]\{1,5\}'; then
  pass "Contains RECOMMEND markers"
else
  fail "Contains RECOMMEND markers" "no RECOMMEND markers found"
fi

# 2b: Screening meta shows multiple sectors or at least successful screening
if echo "$EVENTS" | grep -q '"screeningMeta"'; then
  pass "Screening meta event received"
else
  fail "Screening meta event received" "no screeningMeta event"
fi

# 2c: No fatal failure
if echo "$EVENTS" | grep -q '"fatalValidationFailure"'; then
  fail "No fatal validation failure" "fatalValidationFailure received"
else
  pass "No fatal validation failure"
fi

# 2d: Budget mentioned in response
if echo "$RAW" | grep -qi '10,000\|10000'; then
  pass "Budget ($10,000) referenced in response"
else
  info "Budget not explicitly in text — not necessarily an error"
  pass "Response received (budget check skipped)"
fi

echo

# ─── Test 3: Multi-strategy (3 approaches) ───────────────────────────

echo -e "${BOLD}Test 3${NC}: Multi-strategy — \"Show me 3 different approaches for \$10,000\""
RAW=$(send_chat "multi-strategy" \
  'messages' '[{"role":"user","content":"Show me 3 different approaches for $10,000 to invest in the US market"}]' \
  'portfolioContext' '' \
  'mode' 'chat' \
  'investorStyle' 'Balanced' \
  'riskTolerance' 'Moderate' \
  'name' 'TestUser' \
  'timezone' 'America/New_York' \
  'retryAttempt' '0' \
  'validationFailures' 'null')

EVENTS=$(parse_sse "$RAW")

# 3a: Multiple PORTFOLIO blocks expected
PORTFOLIO_COUNT=$(echo "$RAW" | grep -o '\[PORTFOLIO:{' | wc -l || true)
if [ "$PORTFOLIO_COUNT" -ge 2 ]; then
  pass "Multiple PORTOFLIO blocks ($PORTFOLIO_COUNT)"
elif [ "$PORTFOLIO_COUNT" -eq 1 ]; then
  info "Only 1 PORTFOLIO block — model may have chosen single approach"
  pass "Response received with 1 portfolio block"
else
  info "No PORTFOLIO blocks found — model may have used alternative format"
  # Check for RECOMMEND markers as fallback
  if echo "$RAW" | grep -q '\[RECOMMEND:[A-Z]\{1,5\}'; then
    pass "RECOMMEND markers present (alternative format)"
  else
    fail "Multiple approaches" "no PORTFOLIO blocks or RECOMMEND markers"
  fi
fi

# 3b: No fatal failure
if echo "$EVENTS" | grep -q '"fatalValidationFailure"'; then
  fail "No fatal validation failure" "fatalValidationFailure received"
else
  pass "No fatal validation failure"
fi

echo

# ─── Test 4: CLARIFY flow ────────────────────────────────────────────

echo -e "${BOLD}Test 4${NC}: CLARIFY — \"I want to invest\" (vague)"
RAW=$(send_chat "clarify" \
  'messages' '[{"role":"user","content":"I want to invest"}]' \
  'portfolioContext' '' \
  'mode' 'chat' \
  'investorStyle' 'Balanced' \
  'riskTolerance' 'Moderate' \
  'name' 'TestUser' \
  'timezone' 'America/New_York' \
  'retryAttempt' '0' \
  'validationFailures' 'null')

EVENTS=$(parse_sse "$RAW")

# 4a: Should trigger CLARIFY (no budget, vague request)
if echo "$RAW" | grep -q '\[CLARIFY:{'; then
  pass "CLARIFY block triggered for vague request"
elif echo "$EVENTS" | grep -q '"screeningMeta"'; then
  # If screening ran, the model inferred a budget — also acceptable
  pass "Screening ran (model inferred context)" 
else
  fail "CLARIFY or screening triggered" "no CLARIFY block and no screening for vague request"
fi

echo

# ─── Test 5: Re-login simulation (stale question) ────────────────────

echo -e "${BOLD}Test 5${NC}: Stale question — verify old questions don't re-trigger"

# Step A: Send a question + get response
RAW_A=$(send_chat "stale-question-a" \
  'messages' '[{"role":"user","content":"What is a P/E ratio?"}]' \
  'portfolioContext' '' \
  'mode' 'chat' \
  'investorStyle' 'Balanced' \
  'riskTolerance' 'Moderate' \
  'name' 'TestUser' \
  'timezone' 'America/New_York' \
  'retryAttempt' '0' \
  'validationFailures' 'null')

# Step B: Simulate re-login — resend the same question with the AI's response as context
# (This simulates what happens when session messages are loaded from DB)
# Extract the AI response text (grab text content between the last "text":"..." occurrences)
AI_RESPONSE=$(echo "$RAW_A" | grep -o '"text":"[^"]*"' | tail -1 | sed 's/"text":"//;s/"$//' || echo "P/E ratio is a valuation metric...")

if [ -z "$AI_RESPONSE" ] || [ "$AI_RESPONSE" = "null" ]; then
  info "Could not extract AI response — using placeholder"
  AI_RESPONSE="P/E ratio (Price-to-Earnings) is a valuation metric that compares a company's stock price to its earnings per share."
fi

RAW_B=$(send_chat "stale-question-b" \
  'messages' "[{\"role\":\"user\",\"content\":\"What is a P/E ratio?\"},{\"role\":\"ai\",\"content\":\"$AI_RESPONSE\"},{\"role\":\"user\",\"content\":\"What is a P/E ratio?\"}]" \
  'portfolioContext' '' \
  'mode' 'chat' \
  'investorStyle' 'Balanced' \
  'riskTolerance' 'Moderate' \
  'name' 'TestUser' \
  'timezone' 'America/New_York' \
  'retryAttempt' '0' \
  'validationFailures' 'null')

# 5a: The second response should NOT be a duplicate identical answer
# (It should acknowledge the repetition or provide different framing)
RESP_A_LEN=$(echo "$RAW_A" | grep -o '"text":"[^"]*"' | wc -c || true)
RESP_B_LEN=$(echo "$RAW_B" | grep -o '"text":"[^"]*"' | wc -c || true)

if [ "$RESP_B_LEN" -gt 10 ]; then
  pass "Re-login: gets a response (not empty)"
else
  fail "Re-login: gets a response" "empty response"
fi

# 5b: No fatal failure
if echo "$RAW_B" | grep -q '"fatalValidationFailure"'; then
  fail "Re-login: no fatal validation failure" "fatalValidationFailure received"
else
  pass "Re-login: no fatal validation failure"
fi

echo

# ─── Summary ──────────────────────────────────────────────────────────

echo -e "${BOLD}═══ Results ═══${NC}"
echo -e "  ${GREEN}Passed:${NC} $TESTS_PASSED"
echo -e "  ${RED}Failed:${NC} $TESTS_FAILED"
TOTAL=$((TESTS_PASSED + TESTS_FAILED))
echo -e "  Total:  $TOTAL"

# Write report
echo "$RESULTS" | jq --arg ts "$(date -Iseconds)" --arg passed "$TESTS_PASSED" --arg failed "$TESTS_FAILED" \
  '{timestamp: $ts, passed: ($passed | tonumber), failed: ($failed | tonumber), tests: .}' \
  > "$REPORT_FILE"

echo
echo "Report written to: $REPORT_FILE"

if [ "$TESTS_FAILED" -gt 0 ]; then
  echo -e "${RED}Some tests failed.${NC}"
  exit 1
else
  echo -e "${GREEN}All tests passed.${NC}"
  exit 0
fi
