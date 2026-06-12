#!/bin/bash
# ─── Basket Performance Enricher ─────────────────────────────────
# Fetches active baskets from Supabase, queries Finnhub /stock/metric
# for each unique stock, computes weight-averaged basket performance,
# and updates the performance JSON in Supabase.
#
# Usage: FINNHUB_IO_API_KEY=xxx ./scripts/enrich-basket-perf.sh
# Cron:  run after basket generation (e.g., 30 min after)
# ────────────────────────────────────────────────────────────────

set -e

SUPABASE_URL="${SUPABASE_URL:-https://ixjnuoslbzytubpplkot.supabase.co}"
SUPABASE_KEY="${SUPABASE_ANON_KEY:-eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml4am51b3NsYnp5dHVicHBsa290Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc3NjcyNjAsImV4cCI6MjA5MzM0MzI2MH0.VprRiuUDdQDk5R_vE6Gqx9BKfjOQFyUuhrpsD_5BvwY}"
FINNHUB_KEY="${FINNHUB_IO_API_KEY:-}"

if [ -z "$FINNHUB_KEY" ]; then
  echo "❌ FINNHUB_IO_API_KEY not set. Export it or pass as env var."
  exit 1
fi

echo "📊 Enriching basket performance data..."
echo "   Supabase: $SUPABASE_URL"

# ── 1. Fetch active baskets ──
echo "→ Fetching active baskets..."
BASKETS=$(curl -s "${SUPABASE_URL}/rest/v1/baskets?is_active=eq.true&select=id,theme,name,stocks,performance" \
  -H "apikey: $SUPABASE_KEY" \
  -H "Authorization: Bearer $SUPABASE_KEY")

BASKET_COUNT=$(echo "$BASKETS" | python3 -c "import sys,json; print(len(json.load(sys.stdin)))" 2>/dev/null || echo "0")
echo "   Found $BASKET_COUNT active baskets"

if [ "$BASKET_COUNT" = "0" ]; then
  echo "❌ No active baskets to enrich."
  exit 0
fi

# ── 2. Extract all unique stock symbols ──
SYMBOLS=$(echo "$BASKETS" | python3 -c "
import sys, json
baskets = json.load(sys.stdin)
symbols = set()
for b in baskets:
    stocks = json.loads(b['stocks']) if isinstance(b['stocks'], str) else (b['stocks'] or [])
    for s in stocks:
        symbols.add(s.get('symbol', '').upper())
print('\n'.join(sorted(symbols)))
")

SYMBOL_COUNT=$(echo "$SYMBOLS" | grep -c . || echo "0")
echo "→ $SYMBOL_COUNT unique stocks to query"

# ── 3. Fetch Finnhub performance per stock ──
echo "→ Fetching Finnhub /stock/metric for each..."
declare -A PERF_3M PERF_YTD PERF_1Y PERF_PRICE PERF_BEST

for SYM in $SYMBOLS; do
  [ -z "$SYM" ] && continue
  
  # Fetch quote + metrics in parallel
  QUOTE=$(curl -s --max-time 5 "https://finnhub.io/api/v1/quote?symbol=${SYM}&token=${FINNHUB_KEY}" || echo '{"c":0}')
  METRICS=$(curl -s --max-time 5 "https://finnhub.io/api/v1/stock/metric?symbol=${SYM}&metric=all&token=${FINNHUB_KEY}" || echo '{"metric":{}}')
  
  PRICE=$(echo "$QUOTE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('c',0))" 2>/dev/null || echo "0")
  M=$(echo "$METRICS" | python3 -c "import sys,json; d=json.load(sys.stdin); m=d.get('metric',{}); print(json.dumps(m))" 2>/dev/null || echo "{}")
  
  R3M=$(echo "$M" | python3 -c "import sys,json; print(json.load(sys.stdin).get('13WeekPriceReturnDaily',0))" 2>/dev/null || echo "0")
  RYTD=$(echo "$M" | python3 -c "import sys,json; print(json.load(sys.stdin).get('ytdPriceReturnDaily', json.load(sys.stdin).get('ytdReturnDaily',0)))" 2>/dev/null || echo "0")
  R1Y=$(echo "$M" | python3 -c "import sys,json; print(json.load(sys.stdin).get('52WeekPriceReturnDaily',0))" 2>/dev/null || echo "0")
  
  PERF_3M[$SYM]=$R3M
  PERF_YTD[$SYM]=$RYTD
  PERF_1Y[$SYM]=$R1Y
  PERF_PRICE[$SYM]=$PRICE
  
  # Determine best timeframe
  BEST="1y"
  BEST_VAL=$(echo "$R1Y" | sed 's/-//')
  V3M=$(echo "$R3M" | sed 's/-//')
  VYTD=$(echo "$RYTD" | sed 's/-//')
  if python3 -c "exit(0 if $R3M >= $RYTD and $R3M >= $R1Y else 1)" 2>/dev/null; then BEST="3m"; fi
  if python3 -c "exit(0 if $RYTD >= $R3M and $RYTD >= $R1Y else 1)" 2>/dev/null; then BEST="ytd"; fi
  PERF_BEST[$SYM]=$BEST
  
  echo "   $SYM: \$$PRICE | 3m:${R3M}% ytd:${RYTD}% 1y:${R1Y}%"
done

# ── 4. Compute basket-level performance and update Supabase ──
echo "→ Computing basket performance and updating DB..."
echo "$BASKETS" | python3 -c "
import sys, json, subprocess, os

baskets = json.load(sys.stdin)
perf_3m = {k: float(v) for k,v in dict($(for s in $SYMBOLS; do echo -n "\"$s\":${PERF_3M[$s]},"; done)).items()}
perf_ytd = {k: float(v) for k,v in dict($(for s in $SYMBOLS; do echo -n "\"$s\":${PERF_YTD[$s]},"; done)).items()}
perf_1y = {k: float(v) for k,v in dict($(for s in $SYMBOLS; do echo -n "\"$s\":${PERF_1Y[$s]},"; done)).items()}

supa_url = os.environ.get('SUPABASE_URL', '$SUPABASE_URL')
supa_key = os.environ.get('SUPABASE_ANON_KEY', '$SUPABASE_KEY')

for b in baskets:
    stocks = json.loads(b['stocks']) if isinstance(b['stocks'], str) else (b['stocks'] or [])
    b3m = sum(perf_3m.get(s.get('symbol','').upper(), 0) * s.get('allocation',0)/100 for s in stocks)
    bytd = sum(perf_ytd.get(s.get('symbol','').upper(), 0) * s.get('allocation',0)/100 for s in stocks)
    b1y = sum(perf_1y.get(s.get('symbol','').upper(), 0) * s.get('allocation',0)/100 for s in stocks)
    best_tf = max([('3m', b3m), ('ytd', bytd), ('1y', b1y)], key=lambda x: x[1])[0]
    
    perf_json = json.dumps({
        '3m': round(b3m, 1),
        'ytd': round(bytd, 1),
        '1y': round(b1y, 1),
        'best_timeframe': best_tf
    })
    
    print(f'   {b[\"name\"]}: 3m:{round(b3m,1)}% ytd:{round(bytd,1)}% 1y:{round(b1y,1)}% → best={best_tf}')
    
    # Update via Supabase REST
    import urllib.request
    req = urllib.request.Request(
        f'{supa_url}/rest/v1/baskets?id=eq.{b[\"id\"]}',
        data=json.dumps({'performance': perf_json}).encode(),
        headers={
            'apikey': supa_key,
            'Authorization': f'Bearer {supa_key}',
            'Content-Type': 'application/json',
            'Prefer': 'return=minimal'
        },
        method='PATCH'
    )
    urllib.request.urlopen(req)
" 2>/dev/null

echo ""
echo "✅ Basket performance enrichment complete!"
