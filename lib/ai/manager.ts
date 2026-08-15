// ─── AI Advisor Manager / Triager ──────────────────────────────────
// Phase 2: Conversation classification, state tracking, and duplicate detection.
//
// Responsibilities:
//   1. Classify incoming messages into intent categories
//   2. Track CLARIFY conversation state (open/closed/resolved)
//   3. Detect stale or duplicate requests
//   4. Route to appropriate handler (orchestrator, direct reply, etc.)
//
// This is NEW infrastructure — Phase 0 audit found zero existing
// classification or conversation-state tracking.
// ──────────────────────────────────────────────────────────────────

// ── Types ─────────────────────────────────────────────────

export type IntentCategory =
  | 'portfolio_build'      // user wants a portfolio recommendation
  | 'portfolio_rebalance'  // user wants to rebalance existing holdings
  | 'stock_analysis'       // user wants analysis of specific stock(s)
  | 'trade_instruction'    // user wants to buy/sell a specific security now
  | 'market_question'      // user asks a general market question
  | 'clarify_response'     // user is responding to a CLARIFY prompt
  | 'greeting'             // casual conversation
  | 'unknown';             // fallback

/** What kind of security the user wants: individual stocks, ETFs, both, or not yet specified. */
export type VehiclePreference = 'stocks' | 'etfs' | 'mixed' | 'unspecified';

export interface Classification {
  intent: IntentCategory;
  confidence: number;       // 0–1
  subIntent?: string;       // e.g. "growth", "dividend", "momentum"
  requestedBudget?: number | null;
  mentionedTickers: string[];
  mentionedSectors: string[];
  isStaleDuplicate: boolean;
  needsClarify: boolean;    // AI should ask for clarification
  clarifyReason?: string;
  vehicle: VehiclePreference;        // resolved vehicle preference for THIS message
  needsVehicleClarify: boolean;      // portfolio build with no explicit vehicle
}

export interface ConversationState {
  clarifyOpen: boolean;
  clarifyId?: string;
  clarifyQuestion?: string;
  clarifyOptions?: string[];
  lastIntent?: IntentCategory;
  lastRequestHash?: string;
  requestsSinceLastBuild: number;
  lastBuildSectors?: string[];
  lastBuildBudget?: number;
}

// ── Default state ────────────────────────────────────────

export function createConversationState(): ConversationState {
  return {
    clarifyOpen: false,
    requestsSinceLastBuild: 0,
  };
}

// ── Intent classification ─────────────────────────────────────

// Quick regex-based classification (lightweight, no AI needed for triage).
// Deep classification (screenMessage via DeepSeek) is reserved for
// determining whether to fire web search — that's a different concern.

const PORTFOLIO_BUILD_PATTERNS = [
  // "build me a <…> portfolio" — allows qualifiers (budget, sector, style)
  // between "a/an" and "portfolio" (e.g. "build me a $2k healthcare portfolio").
  /build\s+(?:me\s+)?(?:a|an)\b[^.!?]{0,60}?\bportfolio\b/i,
  /recommend\s+(?:some\s+)?(?:stocks|picks|investments|positions)/i,
  /what\s+should\s+(?:I|we)\s+(?:buy|invest\s+in|pick)/i,
  /I\s+have\s+\$?[\d,.]+\s+(?:to\s+invest|in\s+cash|available)/i,
  /suggest\s+(?:some\s+)?(?:stocks|investments|picks)/i,
  /looking\s+for\s+(?:stocks|ideas|picks|plays|investments)/i,
  /best\s+(?:stocks|picks|plays)\s+(?:in|for)\s+(?:tech|healthcare|energy|finance|ai|semiconductor)/i,
  /show\s+me\s+(?:some\s+)?(?:stocks|picks|ideas)/i,
  /pick\s+(?:me\s+)?(?:some\s+)?(?:stocks|winners)/i,
];

const PORTFOLIO_REBALANCE_PATTERNS = [
  /rebalance\s+(?:my|the)\s+portfolio/i,
  /should\s+I\s+(?:sell|trim|exit|reduce)\s+(?:my\s+)?(?:position|shares|stake)/i,
  /what\s+should\s+I\s+(?:sell|exit|trim)/i,
  /reallocat(?:e|ing)/i,
  /my\s+portfolio\s+(?:is\s+)?(?:too|overly)\s+(?:concentrated|tech|heavy|risky)/i,
  /review\s+my\s+(?:holdings|portfolio|positions)/i,
];

const STOCK_ANALYSIS_PATTERNS = [
  /analy(?:ze|sis|ze)\s+(?:stock\s+)?([A-Z]{1,5})/i,
  /what\s+(?:do\s+you\s+)?think\s+(?:about|of)\s+([A-Z]{1,5})/i,
  /tell\s+me\s+about\s+([A-Z]{1,5})/i,
  /should\s+I\s+(?:buy|sell)\s+([A-Z]{1,5})/i,
  /how\s+(?:is|are)\s+([A-Z]{1,5})\s+(?:doing|looking|performing)/i,
  /is\s+([A-Z]{1,5})\s+(?:a\s+)?(?:good|bad|buy|sell)/i,
  /(?:what|how)\s+(?:about|do\s+you\s+(?:feel|think)\s+about)\s+([A-Z]{1,5})/i,
];

const MARKET_QUESTION_PATTERNS = [
  /^what(?:'s|\s+is)\s+(?:a|an|the)\s+(?:p\/e|pe|eps|roe|beta|market\s+cap|dividend\s+yield|sharpe\s+ratio)/i,
  /^(?:what|how)\s+(?:is|are|does|do)\s+(?:a|an|the|you)\s+(?:define|calculate|measure|use)/i,
  /^(?:explain|define|describe|tell\s+me\s+(?:more\s+)?about)\s+(?:a|an|the|what)\s+(?:p\/e|pe|eps|roe|dividend|yield|ratio)/i,
  /what(?:'s|\s+is)\s+(?:going\s+on|happening)\s+(?:in\s+)?(?:the\s+)?(?:market|economy)/i,
  /why\s+(?:is|are)\s+(?:the\s+)?(?:market|stocks|spy|s&p)\s+(?:up|down|falling|rising)/i,
  /how\s+(?:is|was)\s+(?:the\s+)?(?:market|economy)\s+(?:doing|looking|today)/i,
  /market\s+(?:outlook|prediction|forecast|summary)/i,
  /macro\s+(?:outlook|view|picture|environment)/i,
  /fed\s+(?:rate|interest|decision|meeting)/i,
  /(?:cpi|inflation|jobs\s+report|gdp)\s+(?:data|report|numbers)/i,
  /tell\s+me\s+(?:more\s+)?about\s+(?:the\s+)?(?:economy|inflation|rates|tariffs|trade\s+war)/i,
];

const CLARIFY_RESPONSE_PATTERNS = [
  /^(?:yes|no|maybe|sure|ok|okay|yep|nope|alright|fine|go\s+ahead|cool|got\s+it|understood)\b/i,
  /^(?:option|number|choice)\s*[123]/i,
  /^(?:the|I'll\s+go\s+with|let's\s+do|pick)\s+(?:the\s+)?(?:first|second|third|last|option)/i,
  /^(?:I\s+)?(?:want|prefer|like|choose|select|go\s+for)\b/i,
  /^(?:more\s+|less\s+)?(?:aggressive|conservative|balanced|growth|value|income|tech|defensive)/i,
];

// Direct buy/sell instructions with an explicit security — concrete trade
// orders, NOT open-ended portfolio builds. These must never fall through to
// the budget fallback (which would promote them to `portfolio_build` and route
// them through the stocks/ETFs/mixed vehicle triage).
// Examples: "Buy VOO $1000", "sell NVDA", "buy 2 shares of AAPL", "Buy Apple".
const DIRECT_TRADE_PATTERNS = [
  // Imperative action + ticker (e.g. "Buy VOO $1000", "sell NVDA")
  /\b(?:buy|purchase|sell|short|cover|dump)\b[^.!?]{0,40}?\b\$?([A-Z]{2,5})\b/i,
  // Imperative action + "shares/stock of <name>" (e.g. "buy 2 shares of AAPL")
  /\b(?:buy|purchase|sell|short|cover|dump)\b[^.!?]{0,40}?\b(?:shares?|stock)\s+of\s+([a-z][\w.&]*)/i,
  // Imperative action + company name in title case (e.g. "Buy Apple", "Sell Tesla")
  /\b(?:buy|purchase|sell|short|cover|dump)\b[^.!?]{0,40}?\b([A-Z][a-z]{2,25})\b/i,
];

// ── Sector detection ──────────────────────────────────────────

const SECTOR_KEYWORDS: Record<string, string[]> = {
  technology: ['tech', 'technology', 'software', 'hardware', 'ai', 'artificial intelligence', 'semiconductor', 'cloud', 'saas', 'cyber', 'cybersecurity', 'it '],
  healthcare: ['healthcare', 'health', 'biotech', 'pharma', 'medical', 'drug', 'gene', 'therapeutics'],
  financial_services: ['financial', 'finance', 'bank', 'banking', 'insurance', 'fintech', 'payment'],
  energy: ['energy', 'oil', 'gas', 'solar', 'renewable', 'clean energy', 'utilities'],
  consumer_cyclical: ['consumer', 'retail', 'ecommerce', 'e-commerce', 'auto', 'restaurant', 'travel', 'luxury'],
  industrials: ['industrial', 'manufacturing', 'aerospace', 'defense', 'transport', 'logistics'],
  communication_services: ['communication', 'media', 'telecom', 'entertainment', 'streaming', 'social media'],
  basic_materials: ['material', 'mining', 'chemical', 'metal', 'steel', 'gold', 'copper'],
  real_estate: ['real estate', 'reit', 'property', 'housing'],
  utilities: ['utility', 'electric', 'water', 'power grid'],
};

// ── Vehicle detection (Part B) ───────────────────────────────

/**
 * Detect whether a message explicitly specifies a security vehicle.
 * Used on a single message (fresh build request or follow-up) to decide
 * which screener(s) to run — or whether to ask first.
 */
export function detectVehiclePreference(message: string): VehiclePreference {
  const m = message.toLowerCase();
  const hasEtf = /\betfs?\b|exchange[- ]traded|index funds?\b|index[- ]tracking\b|\bpassive\b/i.test(m);
  const hasStock = /\b(?:individual |single |specific )?stocks?\b|\bequit(?:y|ies)\b|\bstock[- ]picking\b|\b(?:individual |single )?shares?\b/i.test(m);
  if (hasEtf && hasStock) return 'mixed';
  if (hasEtf) return 'etfs';
  if (hasStock) return 'stocks';
  return 'unspecified';
}

/**
 * Detect a bare vehicle-choice reply to the stocks/ETFs/mixed CLARIFY.
 * Returns null when the message is NOT a short vehicle answer, so callers
 * can distinguish a genuine follow-up from an unrelated new request.
 */
export function detectVehicleAnswer(message: string): VehiclePreference | null {
  const m = message.trim().toLowerCase();
  if (!m || m.length > 80) return null;

  // Mixed answers (check first — "stocks and etfs" must not read as stocks)
  if (/^(a\s+)?mix(?:ed|ture)?\b/.test(m) || /^(the\s+)?both\b/.test(m) ||
      /^(a\s+)?(?:combination|blend)\b/.test(m) || /^(a\s+)?mix\s+of\s+both\b/.test(m) ||
      /^(?:stocks?\s*(?:and|\+|&|\/)\s*etfs?|etfs?\s*(?:and|\+|&|\/)\s*stocks?)/.test(m)) {
    return 'mixed';
  }
  // ETF answers
  if (/^(?:just\s+)?(?:etfs?|index\s+funds?|exchange[- ]traded\s+funds?|funds?)\b/.test(m) ||
      /^etfs?\s*(?:only|please)?$/.test(m)) {
    return 'etfs';
  }
  // Stock answers
  if (/^(?:just\s+)?(?:stocks?|equities|individual\s+stocks?|single\s+stocks?|shares?)\b/.test(m) ||
      /^stocks?\s*(?:only|please)?$/.test(m)) {
    return 'stocks';
  }
  return null;
}

// ── Open-CLARIFY scoping (Bug A) ─────────────────────────────
// "A mix of both" is ambiguous: it can answer the VEHICLE clarify (stocks +
// ETFs) OR a MODEL-emitted SUB-SECTOR clarify (e.g. "pharma/biotech vs
// services vs mix"). Reading it as a global vehicle answer regardless of
// context re-resolved the vehicle to 'mixed' on sub-sector follow-ups →
// redundant full re-screen + a confusing model context (the trigger for the
// intermittent blank responses).
//
// We scope by inspecting the most recent assistant CLARIFY block. The
// deterministic vehicle clarify always offers a "Stocks…" option AND an
// "ETFs…" option; any other CLARIFY (sector/sub-sector options) is a
// different question, so "a mix of both" must NOT be read as a vehicle answer.

interface ClarifyBlock { question: string; options: string[]; }

function extractClarifyBlocks(text: string): ClarifyBlock[] {
  const blocks: ClarifyBlock[] = [];
  const re = /\[CLARIFY:(\{.*?\})\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    try {
      const parsed = JSON.parse(m[1]);
      if (parsed && typeof parsed.question === 'string') {
        blocks.push({
          question: parsed.question,
          options: Array.isArray(parsed.options) ? parsed.options.map(String) : [],
        });
      }
    } catch { /* malformed block — ignore */ }
  }
  return blocks;
}

function isVehicleClarify(blocks: ClarifyBlock[]): boolean {
  return blocks.some((b) => {
    const opts = b.options.map((o) => o.toLowerCase());
    return opts.some((o) => /\bstocks?\b/.test(o)) && opts.some((o) => /\betfs?\b/.test(o));
  });
}

/**
 * Classify the CLARIFY question most recently asked by the assistant.
 * 'vehicle'   → the deterministic stocks/ETFs/mixed split.
 * 'subsector' → any other CLARIFY (sector/sub-sector/mix).
 * 'none'      → the last assistant message is a normal reply, or there is none.
 */
function detectOpenClarifyType(
  messages: Array<{ role: string; content: string }>,
): 'vehicle' | 'subsector' | 'none' {
  // Skip the last message — it is the current user input being resolved.
  // The CLARIFY that may be "open" is the one the assistant asked immediately
  // before this input.
  for (let i = messages.length - 2; i >= 0; i--) {
    const m = messages[i];
    if (!m) continue;
    if (m.role === 'user') return 'none'; // reached a user msg before any assistant CLARIFY
    const blocks = extractClarifyBlocks(m.content || '');
    if (blocks.length > 0) return isVehicleClarify(blocks) ? 'vehicle' : 'subsector';
    return 'none'; // last assistant message is not a CLARIFY
  }
  return 'none';
}

/**
 * Resolve the vehicle for the CURRENT request from the full conversation.
 * - If the last message is a bare vehicle answer to the OPEN vehicle clarify
 *   (or, as a legacy fallback, to a prior build that lacked a vehicle), the
 *   answer wins — fresh each request, not stored.
 * - If the last message is a bare "a mix of both" answering a SUB-SECTOR
 *   clarify, it is NOT a vehicle answer; the vehicle is read from the message
 *   directly (→ 'unspecified' for a bare mix), so no redundant full re-screen.
 */
export function resolveVehicleForRequest(
  messages: Array<{ role: string; content: string }>,
): VehiclePreference {
  const last = messages[messages.length - 1]?.content ?? '';
  const answer = detectVehicleAnswer(last);

  if (answer !== null) {
    const openClarify = detectOpenClarifyType(messages);

    if (openClarify === 'subsector') {
      // "A mix of both" answers a sub-sector CLARIFY, not the vehicle split.
      return detectVehiclePreference(last);
    }

    if (openClarify === 'vehicle') {
      return answer;
    }

    // openClarify === 'none' — legacy heuristic: bare vehicle answer following
    // a build request that lacked a vehicle (older clients may not persist the
    // deterministic vehicle CLARIFY as assistant text).
    const priorBuild = [...messages].slice(0, -1).reverse().find(
      (m) => m.role === 'user' && classifyIntent(m.content).intent === 'portfolio_build',
    );
    if (priorBuild && detectVehiclePreference(priorBuild.content) === 'unspecified') {
      return answer;
    }
  }

  return detectVehiclePreference(last);
}

// ── Public API ────────────────────────────────────────────────

/**
 * Classify a user message into an intent category without calling an LLM.
 * Regex-only triage — fast, free, and covers >90% of real-world inputs.
 *
 * @param message - The user's raw message text
 * @param state - Current conversation state (for CLARIFY detection)
 * @returns Classification with intent, confidence, and extracted metadata
 */
export function classifyIntent(message: string, state?: ConversationState): Classification {
  // Default classification
  const classification: Classification = {
    intent: 'unknown',
    confidence: 0,
    mentionedTickers: extractTickersFromText(message),
    mentionedSectors: detectSectors(message),
    isStaleDuplicate: false,
    needsClarify: false,
    vehicle: detectVehiclePreference(message),
    needsVehicleClarify: false,
    requestedBudget: null,
  };

  // ── CLARIFY response detection (must check FIRST if clarify is open) ──
  if (state?.clarifyOpen) {
    for (const pattern of CLARIFY_RESPONSE_PATTERNS) {
      if (pattern.test(message.trim())) {
        classification.intent = 'clarify_response';
        classification.confidence = 0.85;
        classification.mentionedSectors = classification.mentionedSectors.length > 0
          ? classification.mentionedSectors
          : state.lastBuildSectors || [];
        return classification;
      }
    }
    // If clarify is open but response doesn't match, could be a redirect
    // Keep the old intent if the user is providing new info
  }

  // ── Explicit portfolio building ──
  for (const pattern of PORTFOLIO_BUILD_PATTERNS) {
    if (pattern.test(message)) {
      classification.confidence = 0.9;
      classification.requestedBudget = extractBudgetFromText(message);
      classification.intent = 'portfolio_build';
      break;
    }
  }

  // ── Portfolio rebalancing ──
  if (classification.confidence < 0.5) {
    for (const pattern of PORTFOLIO_REBALANCE_PATTERNS) {
      if (pattern.test(message)) {
        classification.confidence = 0.85;
        classification.intent = 'portfolio_rebalance';
        break;
      }
    }
  }

  // ── Stock analysis ──
  if (classification.confidence < 0.5) {
    for (const pattern of STOCK_ANALYSIS_PATTERNS) {
      const match = pattern.exec(message);
      if (match) {
        classification.confidence = 0.9;
        classification.intent = 'stock_analysis';
        break;
      }
    }
  }

  // ── Market question ──
  if (classification.confidence < 0.5) {
    for (const pattern of MARKET_QUESTION_PATTERNS) {
      if (pattern.test(message)) {
        classification.confidence = 0.8;
        classification.intent = 'market_question';
        break;
      }
    }
  }

  // ── Direct trade instruction (must precede the budget fallback) ──
  // A concrete buy/sell order with an explicit security is NOT a portfolio
  // build. "Buy VOO $1000" is unambiguous — routing it through vehicle triage
  // (stocks/ETFs/mixed CLARIFY) is a bug. Classify it as a trade instruction so
  // it proceeds straight to ticker resolution + Trade-Gate.
  if (classification.confidence < 0.5) {
    for (const pattern of DIRECT_TRADE_PATTERNS) {
      if (pattern.test(message)) {
        classification.intent = 'trade_instruction';
        classification.confidence = 0.9;
        break;
      }
    }
  }

  // ── Fallback: check for budget mentions that imply portfolio build ──
  // NOTE: `requestedBudget` is initialized to `null` above and only populated
  // inside the pattern loops, so a bare `requestedBudget !== null` would
  // misclassify EVERY unclassified message as a build. Check the message
  // directly instead.
  if (classification.intent === 'unknown') {
    const fallbackBudget = extractBudgetFromText(message);
    if (fallbackBudget !== null) {
      classification.intent = 'portfolio_build';
      classification.confidence = 0.6;
      classification.requestedBudget = fallbackBudget;
    }
  }

  // ── Sub-intent detection ──
  if (classification.intent === 'portfolio_build' || classification.intent === 'stock_analysis') {
    if (/\b(growth|growing|expansion)\b/i.test(message)) classification.subIntent = 'growth';
    else if (/\b(dividend|income|yield|payout)\b/i.test(message)) classification.subIntent = 'dividend';
    else if (/\b(value|undervalued|cheap|bargain|discount)\b/i.test(message)) classification.subIntent = 'value';
    else if (/\b(momentum|breakout|trending|hot|surging)\b/i.test(message)) classification.subIntent = 'momentum';
    else if (/\b(safe|stable|defensive|conservative|recession)\b/i.test(message)) classification.subIntent = 'defensive';
  }

  // ── Check if this needs clarification ──
  if (classification.intent === 'portfolio_build' && classification.mentionedSectors.length === 0) {
    classification.needsClarify = true;
    classification.clarifyReason = 'No sector preference detected — user may need to specify';
  }

  // ── Vehicle triage (Part B): a portfolio build with no explicit vehicle ──
  // is routed to a deterministic stocks/ETFs/mixed CLARIFY before any screening.
  if (classification.intent === 'portfolio_build' && classification.vehicle === 'unspecified') {
    classification.needsVehicleClarify = true;
  }

  return classification;
}

/**
 * Update conversation state based on a new message and its classification.
 * Returns the new state (immutable).
 */
export function updateConversationState(
  prevState: ConversationState,
  classification: Classification,
  message: string,
): ConversationState {
  const hash = simpleHash(message.trim().slice(0, 200));

  const state: ConversationState = {
    ...prevState,
    lastIntent: classification.intent,
    lastRequestHash: hash,
    requestsSinceLastBuild: prevState.requestsSinceLastBuild + 1,
  };

  // Reset build counter on new portfolio build
  if (classification.intent === 'portfolio_build') {
    state.requestsSinceLastBuild = 1;
    state.lastBuildSectors = classification.mentionedSectors;
    state.lastBuildBudget = classification.requestedBudget ?? undefined;
    state.clarifyOpen = classification.needsClarify;
    if (!classification.needsClarify) {
      state.clarifyId = undefined;
      state.clarifyQuestion = undefined;
      state.clarifyOptions = undefined;
    }
  }

  // CLARIFY response: close the clarify loop
  if (classification.intent === 'clarify_response') {
    state.clarifyOpen = false;
  }

  return state;
}

/**
 * Detect if the current message is a stale duplicate of the previous request.
 * Compares message hashes and sector/budget similarity.
 */
export function detectStaleDuplicate(
  current: Classification,
  prevState: ConversationState,
): boolean {
  if (!prevState.lastBuildSectors || !prevState.lastBuildBudget) return false;

  // Same sectors + same budget + within last 3 messages = stale
  const sameSectors = arraysEqual(current.mentionedSectors.sort(), prevState.lastBuildSectors.sort());
  const sameBudget = current.requestedBudget === prevState.lastBuildBudget;
  const withinWindow = prevState.requestsSinceLastBuild <= 3;

  return sameSectors && sameBudget && withinWindow;
}

// ── Helpers ─────────────────────────────────────────────────────

function extractTickersFromText(text: string): string[] {
  const matches = text.match(/\$?\b([A-Z]{2,5})\b/g);
  if (!matches) return [];
  return [...new Set(matches.map(m => m.replace('$', '').toUpperCase()))];
}

function detectSectors(text: string): string[] {
  const found: string[] = [];
  const lower = text.toLowerCase();
  for (const [sector, keywords] of Object.entries(SECTOR_KEYWORDS)) {
    if (keywords.some(kw => lower.includes(kw))) {
      found.push(sector);
    }
  }
  return found;
}

function extractBudgetFromText(text: string): number | null {
  // Match patterns like "$5000", "$5,000", "$5k", "5000 dollars", "5 grand"
  const dollarMatch = text.match(/\$(\d{1,3}(?:,\d{3})*(?:\.\d+)?)/);
  if (dollarMatch) return parseFloat(dollarMatch[1].replace(/,/g, ''));

  const kMatch = text.match(/\$(\d+(?:\.\d+)?)\s*k\b/i);
  if (kMatch) return parseFloat(kMatch[1]) * 1000;

  const numberWord = text.match(/(\d+(?:,\d{3})*(?:\.\d+)?)\s*(?:dollars|bucks|grand)/i);
  if (numberWord) return parseFloat(numberWord[1].replace(/,/g, ''));

  return null;
}

function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const chr = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + chr;
    hash |= 0;
  }
  return hash.toString(36);
}

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
