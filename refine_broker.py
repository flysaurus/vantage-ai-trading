#!/usr/bin/env python3
"""Apply refinements to demo-broker.ts: isOpen local var, removePosition rename, executionPlan naming."""
path = '/root/.openclaw/workspace/projects/vantage/lib/broker/demo-broker.ts'
with open(path, 'r') as f:
    content = f.read()

# 1. placeOrder — use cached isOpen instead of market.isOpen throughout
old = "const market = getMarketStatus();\n    const quote"
new = "const isOpen = this.isMarketOpen();\n    const quote"
assert content.count(old) == 1, f"1 failed: {content.count(old)}"
content = content.replace(old, new)

# 2. In BUY order: status and fillPrice based on cached isOpen
old = "status: market.isOpen ? 'FILLED' : 'OPEN',"
assert content.count(old) == 1
content = content.replace(old, "status: isOpen ? 'FILLED' : 'OPEN',")

# 3. fillPrice: isOpen
for old in ["fillPrice: market.isOpen ? price : undefined,"]:
    assert content.count(old) == 1, f"3a failed: {content.count(old)}"
    content = content.replace(old, "fillPrice: isOpen ? price : undefined,")

# 4. filledAt: isOpen
old = "filledAt: market.isOpen ? new Date().toISOString() : undefined,"
assert content.count(old) >= 1
content = content.replace(old, "filledAt: isOpen ? new Date().toISOString() : undefined,")

# 5. reservedCost
old = "reservedCost: market.isOpen ? undefined : cost,"
assert content.count(old) == 1
content = content.replace(old, "reservedCost: isOpen ? undefined : cost,")

# 6. note using this.getNextOpenLabel()
old = "note: market.isOpen ? undefined : `${market.nextOpenLabel}`,"
assert content.count(old) == 1
content = content.replace(old, "note: isOpen ? undefined : `Pending · ${this.getNextOpenLabel()}`,")

# 7. upsertPosition guard
old = "if (market.isOpen) {"
# Should appear at least twice (placeOrder BUY + basket)
content = content.replace(old, "if (isOpen) {")

# 8. Return values using isOpen
for old in ["nextOpenLabel: market.isOpen ? undefined : market.nextOpenLabel,"]:
    n = content.count(old)
    if n > 0:
        content = content.replace(old, "nextOpenLabel: isOpen ? undefined : this.getNextOpenLabel(),")

old = "fillPrice: market.isOpen ? price : undefined,"
if content.count(old) > 0:
    content = content.replace(old, "fillPrice: isOpen ? price : undefined,")

old = "filledShares: market.isOpen ? shares : undefined,"
if content.count(old) > 0:
    content = content.replace(old, "filledShares: isOpen ? shares : undefined,")

old = "filledAt: market.isOpen ? new Date().toISOString() : undefined,"
# Already replaced above

# 9. SELL: use find + rename removeShares -> removePosition
old_sell = "const posIdx = this.state.positions.findIndex(p => p.symbol === req.symbol);\n    if (posIdx === -1 || this.state.positions[posIdx].shares < shares) {\n      return { success: false, orderId, status: 'REJECTED', message: `Insufficient shares of ${req.symbol}` };\n    }\n\n    const proceeds = shares * price;\n    this.removeShares(req.symbol, shares);"
new_sell = "const position = this.state.positions.find(p => p.symbol === req.symbol);\n    if (!position || position.shares < shares) {\n      return { success: false, orderId, status: 'REJECTED', message: `Insufficient shares of ${req.symbol}` };\n    }\n\n    const proceeds = shares * price;\n    this.removePosition(req.symbol, shares);"
assert content.count(old_sell) == 1, f"9 failed: {content.count(old_sell)}"
content = content.replace(old_sell, new_sell)

# 10. Basket: plan → executionPlan, market → isOpen
old = "const market = getMarketStatus();\n\n    // Fetch all prices in parallel"
new = "const isOpen = this.isMarketOpen();\n\n    // Fetch all prices in parallel"
# Already changed above, so check for basket version
old_basket = "const market = getMarketStatus();\n\n    // Fetch all prices in parallel\n    const priceResults"
new_basket = "const isOpen = this.isMarketOpen();\n\n    // Fetch all prices in parallel\n    const priceResults"
assert content.count(old_basket) == 1, f"10 failed: {content.count(old_basket)}"
content = content.replace(old_basket, new_basket)

# 11. Rename 'plan' to 'executionPlan' in basket
old = "const plan = req.stocks.map((s, i) => {"
assert content.count(old) == 1
content = content.replace(old, "const executionPlan = req.stocks.map((s, i) => {")

old = "}).filter(s => s.price > 0 && s.shares > 0);\n\n    if (plan.length === 0) {"
assert content.count(old) == 1
content = content.replace(old, "}).filter(s => s.price > 0 && s.shares > 0);\n\n    if (executionPlan.length === 0) {")

old = "const totalCost = plan.reduce((sum, s) => sum + s.dollarAmount, 0);"
assert content.count(old) == 1
content = content.replace(old, "const totalCost = executionPlan.reduce((sum, s) => sum + s.dollarAmount, 0);")

# 12. Basket orders map over executionPlan
old = "const orders: BrokerOrder[] = plan.map(s => ({"
assert content.count(old) == 1
content = content.replace(old, "const orders: BrokerOrder[] = executionPlan.map(s => ({")

# 13. Basket fill loop
old = "for (const s of plan) {"
assert content.count(old) == 1
content = content.replace(old, "for (const s of executionPlan) {")

# 14. failed: plan.length -> executionPlan.length
old = "failed: plan.length - executed,"
assert content.count(old) == 1
content = content.replace(old, "failed: executionPlan.length - executed,")

# 15. executed: plan.length
old = "executed: plan.length, failed: 0,"
assert content.count(old) == 1
content = content.replace(old, "executed: executionPlan.length, failed: 0,")

# 16. pending baskets: stocks: plan -> executionPlan
old = "stocks: plan,"
assert content.count(old) == 1
content = content.replace(old, "stocks: executionPlan,")

# 17. pending nextOpenLabel
# Should use this.getNextOpenLabel() instead of market.nextOpenLabel
remaining_market = content.count("market.nextOpenLabel")
print(f"Remaining market.nextOpenLabel references: {remaining_market}")
while "market.nextOpenLabel" in content:
    content = content.replace("market.nextOpenLabel", "this.getNextOpenLabel()")

# 18. Rename removeShares method to removePosition
old = "private removeShares(symbol: string, shares: number): void {"
assert content.count(old) == 1
content = content.replace(old, "private removePosition(symbol: string, shares: number): void {")

# Clean up duplicate 'Pending · ' prefixes if any slipped in
content = content.replace("`Pending · `Pending · ", "`Pending · ")

with open(path, 'w') as f:
    f.write(content)
print("✅ All refinements applied")
