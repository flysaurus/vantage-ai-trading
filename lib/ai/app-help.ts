// ─── Deterministic App-Help Router ────────────────────────────
// Catches app-related questions — "what can you do?", "help", "how do I
// rebalance/set up DCA/change my style/connect my broker/set alerts/add funds"
// — and answers them with grounded, deterministic text (no model call).
//
// Rationale: these are the highest-risk fallthrough cases. A free-form model
// either hallucinated app capabilities/navigation or mis-routed "how do I
// rebalance" into an actual rebalance plan. Answering deterministically means a
// user asking about the app always gets an accurate, stable reply.
// ──────────────────────────────────────────────────────────────

export type AppHelpKind =
  | 'capabilities'
  | 'how_to_rebalance'
  | 'how_to_dca'
  | 'how_to_style'
  | 'how_to_broker'
  | 'how_to_alerts'
  | 'how_to_funds';

/**
 * Detect an app-usage/help question. Returns null when the message is an actual
 * command (e.g. "rebalance", "change my style to Lynch") or anything else that
 * should keep flowing to the deterministic account-action / model pipeline.
 */
export function detectAppHelpIntent(message: string): AppHelpKind | null {
  const m = message.trim();
  if (!m || m.length > 160) return null;
  const lower = m.toLowerCase();

  // ── How-to questions (specific first) ──
  // "how do I / how to / how does one + <verb>"
  const how = /\bhow (do i|to|does one|does|can i)\b/i.test(lower);

  if (how && /\brebalanc/i.test(lower)) return 'how_to_rebalance';
  if (/\bwhat is rebalanc/i.test(lower) || /\bhow does rebalanc/i.test(lower)) return 'how_to_rebalance';

  if (how && /\b(dca|dollar[ -]?cost|recurring invest|automated invest|dollar cost averaging)\b/i.test(lower)) return 'how_to_dca';
  if (/\bwhat is (dca|dollar[ -]?cost averaging)\b/i.test(lower)) return 'how_to_dca';

  if (how && /\b(change|switch|set|pick|choose|select)\b.*\bstyle\b/i.test(lower)) return 'how_to_style';

  if (how && /\b(connect|link|add|attach|set up|setup)\b.*\b(broker|account|snaptrade|bank|portfolio)\b/i.test(lower)) return 'how_to_broker';

  if (how && /\balerts?\b/i.test(lower)) return 'how_to_alerts';

  if (how && /\b(add|deposit|withdraw|fund|transfer|move)\b.*\b(cash|money|funds|buying power|dollars)\b/i.test(lower)) return 'how_to_funds';

  // ── Capabilities / help (whole-message, so "help me rebalance" still flows) ──
  if (/^(help|help me|help me please|what can you do|what can i ask|what can you help with|what can you help me with|what are you|what features do you have|what features|capabilities|how do you work|what do you do|menu|options|what can you help|what do you help with)[?.!]*$/i.test(m)) {
    return 'capabilities';
  }

  return null;
}

const CAPABILITIES_ANSWER = [
  "Here's what I can do in Vantage:",
  '',
  '**Portfolio**',
  '• Analyze your portfolio, positions, and risk',
  '• Rebalance to match your investor style (budget → plan → ✓ Confirm)',
  '• Set up dollar-cost averaging (DCA) plans',
  '',
  '**Investor style**',
  '• Change your style — Buffett, Lynch, Livermore, Munger, or Soros',
  '• Explain your style and risk profile',
  '',
  '**Markets**',
  '• Research stocks & ETFs, news, and sentiment',
  '• Strategy ideas, market pulse, macro calendar',
  '',
  '**Alerts & automation**',
  '• Price and keyword alerts, daily briefs, weekly snapshots',
  '',
  'Just tell me what you want — e.g. "rebalance", "set up a DCA plan", or "change my style to Lynch".',
].join('\n');

export function buildAppHelpAnswer(kind: AppHelpKind): string {
  switch (kind) {
    case 'capabilities':
      return CAPABILITIES_ANSWER;

    case 'how_to_rebalance':
      return [
        'To rebalance, just say **"rebalance"** (or tap Rebalance in Quick Tools). I\'ll walk you through:',
        '',
        '1. **Budget** — available cash only, full portfolio, or a custom amount',
        '2. **Asset class** — ETFs, individual stocks, or a mix',
        '3. A **plan** showing the exact buys (and sells for full-portfolio) vs your style targets',
        '',
        'Nothing executes until you hit **✓ Confirm**. Say "rebalance" to start.',
      ].join('\n');

    case 'how_to_dca':
      return [
        'To set up dollar-cost averaging, tell me the **symbol, amount, frequency, and end date** — for example:',
        '',
        '"invest $100 weekly into VOO for 12 months"',
        '',
        'I\'ll show you a preview first; nothing runs until you confirm. You can also open the DCA setup screen from Strategies.',
      ].join('\n');

    case 'how_to_style':
      return [
        'You can change your investor style anytime — just say **"change my style"** and I\'ll show the five styles:',
        '',
        '• Buffett (Value)',
        '• Lynch (GARP)',
        '• Livermore (Momentum)',
        '• Munger (Quality)',
        '• Soros (Macro)',
        '',
        'Pick one and I\'ll update your profile, then offer to rebalance your portfolio to match it.',
      ].join('\n');

    case 'how_to_broker':
      return [
        'To connect a live brokerage, open the **Accounts** screen and choose **Connect broker** — this runs the SnapTrade linking flow.',
        '',
        'Once linked, your real positions, balances, and orders sync automatically. You can also test everything on the **demo portfolio** without connecting a broker.',
      ].join('\n');

    case 'how_to_alerts':
      return [
        'Set alerts from the **Alerts** screen (or just ask me to set one). You can create:',
        '',
        '• **Price alerts** — notify when a ticker crosses a target',
        '• **Keyword alerts** — notify on matching news',
        '',
        'Alerts surface in-app and (if enabled) on Telegram.',
      ].join('\n');

    case 'how_to_funds':
      return [
        'Funds live on the broker side — Vantage doesn\'t hold or move cash directly.',
        '',
        'To add buying power, deposit into your linked brokerage account; the balance appears here after the next sync. Meanwhile you can test strategies on the demo portfolio.',
      ].join('\n');

    default:
      return CAPABILITIES_ANSWER;
  }
}
