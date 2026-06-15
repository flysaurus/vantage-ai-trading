import re

path = '/root/.openclaw/workspace/projects/vantage/lib/broker/demo-broker.ts'
with open(path, 'r') as f:
    c = f.read()

# Do all replacements in a single pass
reps = [
    # placeOrder: cached isOpen local
    ('const market = getMarketStatus();\n    const quote', 'const isOpen = this.isMarketOpen();\n    const quote'),
    # basket: cached isOpen local  
    ('const market = getMarketStatus();\n\n    // Fetch all prices in parallel\n    const priceResults', 'const isOpen = this.isMarketOpen();\n\n    // Fetch all prices in parallel\n    const priceResults'),
]

for old, new in reps:
    count = c.count(old)
    if count > 0:
        c = c.replace(old, new)
        print(f'  Replaced: {count}x')
    else:
        print(f'  SKIP (not found)')

# Replace all market.isOpen -> isOpen (in function bodies that have const isOpen)
# But carefully — only within the methods where isOpen is defined
# Safer: replace specific patterns
patterns = [
    ("market.isOpen ? 'FILLED' : 'OPEN'", "isOpen ? 'FILLED' : 'OPEN'"),
    ('market.isOpen ? price : undefined', 'isOpen ? price : undefined'),
    ('market.isOpen ? new Date().toISOString() : undefined', 'isOpen ? new Date().toISOString() : undefined'),
    ('market.isOpen ? undefined : cost', 'isOpen ? undefined : cost'),
    ("market.isOpen ? undefined : `${market.nextOpenLabel}`", "isOpen ? undefined : `Pending · ${this.getNextOpenLabel()}`"),
    ('market.nextOpenLabel', 'this.getNextOpenLabel()'),
]
for old, new in patterns:
    count = c.count(old)
    if count > 0:
        c = c.replace(old, new)
        print(f'  Pattern replaced: {count}x')
    else:
        print(f'  Pattern SKIP: {old[:60]}')

# SELL: posIdx -> position pattern
c = c.replace(
    "const posIdx = this.state.positions.findIndex(p => p.symbol === req.symbol);\n    if (posIdx === -1 || this.state.positions[posIdx].shares < shares) {\n      return { success: false, orderId, status: 'REJECTED', message: `Insufficient shares of ${req.symbol}` };\n    }\n\n    const proceeds = shares * price;\n    this.removeShares(req.symbol, shares);",
    "const position = this.state.positions.find(p => p.symbol === req.symbol);\n    if (!position || position.shares < shares) {\n      return { success: false, orderId, status: 'REJECTED', message: `Insufficient shares of ${req.symbol}` };\n    }\n\n    const proceeds = shares * price;\n    this.removePosition(req.symbol, shares);"
)
print('  SELL block replaced' if 'removePosition' in c else '  SELL block SKIP')

# plan -> executionPlan
for old, new in [
    ('const plan = req.stocks.map', 'const executionPlan = req.stocks.map'),
    ('if (plan.length === 0)', 'if (executionPlan.length === 0)'),
    ('const totalCost = plan.reduce', 'const totalCost = executionPlan.reduce'),
    ('const orders: BrokerOrder[] = plan.map', 'const orders: BrokerOrder[] = executionPlan.map'),
    ('for (const s of plan)', 'for (const s of executionPlan)'),
    ('failed: plan.length', 'failed: executionPlan.length'),
    ('executed: plan.length', 'executed: executionPlan.length'),
    ('stocks: plan,', 'stocks: executionPlan,'),
]:
    count = c.count(old)
    if count > 0:
        c = c.replace(old, new)
        print(f'  plan->executionPlan: {count}x')
    else:
        print(f'  plan SKIP: {old[:50]}')

# Rename removeShares -> removePosition
c = c.replace('private removeShares(', 'private removePosition(')
print(f'  removeShares renamed: {"private removePosition(" in c}')

# Clean double prefixes
c = c.replace('`Pending · `Pending · ', '`Pending · ')
c = c.replace('`Pending ·  this.getNextOpenLabel()', '`Pending · ${this.getNextOpenLabel()}`')

with open(path, 'w') as f:
    f.write(c)
print('\n✅ Done')
