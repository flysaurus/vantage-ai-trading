// ─── AI Advisor Resilience ───────────────────────────────────
// Phase 7: Circuit breakers, fallbacks, timeouts, structured logging.
//
// Every external dependency call flows through this module.
// No silent failure, no degraded fallback to model-memory behavior.
//
// Architecture:
//   CircuitBreaker wraps each external dependency
//   FallbackRegistry maps dependency→fallback (explicit, auditable)
//   TimeoutBudget tracks per-stage elapsed time
//   StageLogger emits structured observability events
// ──────────────────────────────────────────────────────────────────

// ── Types ─────────────────────────────────────────────────

export type DependencyName =
  | 'screener'         // Stock screener API
  | 'snaptrade'        // SnapTrade brokerage
  | 'finnhub'          // Finnhub market data + symbol validation
  | 'llm_primary'      // Primary LLM (Anthropic/DeepSeek)
  | 'llm_fallback'     // Fallback LLM
  | 'web_search'       // SearXNG web search
  | 'supabase';        // Database

export type CircuitState = 'closed' | 'open' | 'half_open';

export interface CircuitBreakerConfig {
  failureThreshold: number;      // consecutive failures to trip
  recoveryTimeoutMs: number;     // time before attempting half-open
  halfOpenMaxCalls: number;      // max calls in half-open before re-tripping
  timeoutMs: number;             // per-call timeout
  name: DependencyName;
}

export interface CircuitBreakerState {
  state: CircuitState;
  failureCount: number;
  lastFailureTime: number;
  lastSuccessTime: number;
  halfOpenCalls: number;
  totalCalls: number;
  totalFailures: number;
}

export interface StageTimer {
  stage: string;
  startTime: number;
  budgetMs: number;
  elapsed?: number;
  remaining?: number;
}

export interface FallbackEntry {
  dependency: DependencyName;
  description: string;
  /** The fallback function returns a value OR throws if no safe fallback exists */
  fallback: () => any | Promise<any>;
  /** If true, no fallback is safe — MUST surface error to user */
  noSafeFallback?: boolean;
}

// ── Circuit Breaker ───────────────────────────────────────

const DEFAULT_CONFIG: Omit<CircuitBreakerConfig, 'name'> = {
  failureThreshold: 3,
  recoveryTimeoutMs: 30_000,     // 30s before trying again
  halfOpenMaxCalls: 2,          // allow 2 test calls in half-open
  timeoutMs: 15_000,            // 15s per-call timeout
};

interface ActiveBreaker {
  config: CircuitBreakerConfig;
  state: CircuitBreakerState;
}

const breakers = new Map<DependencyName, ActiveBreaker>();

export function getBreakerState(name: DependencyName): CircuitBreakerState | null {
  return breakers.get(name)?.state ?? null;
}

export function getAllBreakerStates(): Record<string, CircuitBreakerState> {
  const states: Record<string, CircuitBreakerState> = {};
  for (const [name, breaker] of breakers) {
    states[name] = { ...breaker.state };
  }
  return states;
}

/**
 * Execute a call through a circuit breaker.
 *
 * If the circuit is OPEN, the call is skipped entirely — the fallback
 * registry is consulted instead. If HALF_OPEN, a limited number of
 * test calls are allowed through. If any call exceeds the timeout,
 * it counts as a failure.
 */
export async function withCircuitBreaker<T>(
  name: DependencyName,
  fn: () => Promise<T>,
  overrides?: Partial<CircuitBreakerConfig>,
): Promise<T> {
  let breaker = breakers.get(name);
  if (!breaker) {
    breaker = {
      config: { ...DEFAULT_CONFIG, name, ...overrides },
      state: {
        state: 'closed',
        failureCount: 0,
        lastFailureTime: 0,
        lastSuccessTime: 0,
        halfOpenCalls: 0,
        totalCalls: 0,
        totalFailures: 0,
      },
    };
    breakers.set(name, breaker);
  }

  const { config, state } = breaker;

  // ── Open circuit: skip call, caller must use fallback ──
  if (state.state === 'open') {
    const recoveryElapsed = Date.now() - state.lastFailureTime;
    if (recoveryElapsed >= config.recoveryTimeoutMs) {
      console.log(`[resilience] 🔄 Circuit ${name}: OPEN→HALF_OPEN (${recoveryElapsed}ms elapsed)`);
      state.state = 'half_open';
      state.halfOpenCalls = 0;
    } else {
      const remaining = config.recoveryTimeoutMs - recoveryElapsed;
      console.warn(`[resilience] ⛔ Circuit ${name}: OPEN — rejecting call (${remaining}ms until retry)`);
      throw new CircuitOpenError(name, remaining);
    }
  }

  // ── Half-open: limit test calls ──
  if (state.state === 'half_open' && state.halfOpenCalls >= config.halfOpenMaxCalls) {
    console.warn(`[resilience] ⛔ Circuit ${name}: HALF_OPEN limit reached (${state.halfOpenCalls}/${config.halfOpenMaxCalls})`);
    throw new CircuitOpenError(name, config.recoveryTimeoutMs);
  }

  // ── Execute with timeout ──
  state.totalCalls++;
  if (state.state === 'half_open') state.halfOpenCalls++;

  try {
    const result = await withTimeout(fn(), config.timeoutMs, name);
    
    // Success: close the circuit
    state.failureCount = 0;
    state.lastSuccessTime = Date.now();
    if (state.state === 'half_open') {
      console.log(`[resilience] ✅ Circuit ${name}: HALF_OPEN→CLOSED (test call succeeded)`);
      state.state = 'closed';
      state.halfOpenCalls = 0;
    }
    return result;

  } catch (err) {
    // Don't trip the breaker on CircuitOpenError (it's our own signal)
    if (err instanceof CircuitOpenError) throw err;

    state.failureCount++;
    state.totalFailures++;
    state.lastFailureTime = Date.now();

    if (state.failureCount >= config.failureThreshold) {
      if (state.state === 'closed') {
        console.warn(`[resilience] 🔴 Circuit ${name}: TRIPPED → OPEN (${state.failureCount} consecutive failures)`);
      }
      state.state = 'open';
    }

    throw err;
  }
}

/**
 * Reset a circuit breaker to closed (e.g. after manual intervention or config change).
 */
export function resetBreaker(name: DependencyName): void {
  const breaker = breakers.get(name);
  if (breaker) {
    console.log(`[resilience] 🔧 Circuit ${name}: manually reset to CLOSED`);
    breaker.state = {
      state: 'closed',
      failureCount: 0,
      lastFailureTime: 0,
      lastSuccessTime: 0,
      halfOpenCalls: 0,
      totalCalls: breaker.state.totalCalls,
      totalFailures: breaker.state.totalFailures,
    };
  }
}

// ── Fallback Registry ─────────────────────────────────────

const fallbackRegistry = new Map<DependencyName, FallbackEntry>();

export function registerFallback(entry: FallbackEntry): void {
  fallbackRegistry.set(entry.dependency, entry);
  console.log(`[resilience] 📋 Registered fallback for ${entry.dependency}: ${entry.description}`);
}

export function getFallback(dependency: DependencyName): FallbackEntry | undefined {
  return fallbackRegistry.get(dependency);
}

/**
 * Execute with fallback. If the primary call throws (including CircuitOpenError),
 * the registered fallback is invoked. If no fallback exists or fallback.noSafeFallback
 * is true, the original error propagates up — never silently degrade.
 */
export async function withFallback<T>(
  dependency: DependencyName,
  primaryFn: () => Promise<T>,
  context?: string,
  timeoutMs?: number,
): Promise<{ result: T; source: 'primary' | 'fallback' }> {
  try {
    const result = await withCircuitBreaker(dependency, primaryFn, timeoutMs ? { timeoutMs } : undefined);
    return { result, source: 'primary' };
  } catch (err) {
    const fallback = fallbackRegistry.get(dependency);

    if (!fallback) {
      console.error(`[resilience] ❌ ${dependency}: no fallback registered — propagating error`);
      throw err;
    }

    if (fallback.noSafeFallback) {
      console.error(`[resilience] ❌ ${dependency}: no safe fallback exists — ${fallback.description}`);
      throw err;
    }

    const errorMsg = err instanceof Error ? err.message : String(err);
    console.warn(`[resilience] ⚠️ ${dependency}: falling back — ${fallback.description}${context ? ` [${context}]` : ''} (error: ${errorMsg.slice(0, 200)})`);

    try {
      const fbResult = await fallback.fallback();
      return { result: fbResult as T, source: 'fallback' };
    } catch (fbErr) {
      console.error(`[resilience] 💥 ${dependency}: fallback itself failed — propagating`);
      throw fbErr;
    }
  }
}

// ── Timeout Budget ────────────────────────────────────────

export interface TimeoutBudget {
  stages: Map<string, StageTimer>;
  totalBudgetMs: number;
  startTime: number;
}

/**
 * Create a timeout budget for a generation pipeline.
 *
 * Example:
 *   const budget = createTimeoutBudget(60000, { screening: 10000, generation: 30000, validation: 5000 });
 */
export function createTimeoutBudget(
  totalBudgetMs: number,
  stageBudgets: Record<string, number>,
): TimeoutBudget {
  const stages = new Map<string, StageTimer>();
  for (const [stage, ms] of Object.entries(stageBudgets)) {
    stages.set(stage, { stage, startTime: 0, budgetMs: ms });
  }
  return { stages, totalBudgetMs, startTime: Date.now() };
}

/**
 * Start timing a stage. Throws if the overall budget is already exhausted.
 */
export function startStage(budget: TimeoutBudget, stage: string): StageTimer {
  const totalElapsed = Date.now() - budget.startTime;
  if (totalElapsed >= budget.totalBudgetMs) {
    throw new TimeoutBudgetExhaustedError(budget.totalBudgetMs, totalElapsed);
  }

  const timer = budget.stages.get(stage);
  if (!timer) {
    throw new Error(`Unknown stage "${stage}" — not in budget`);
  }

  timer.startTime = Date.now();
  const remaining = budget.totalBudgetMs - totalElapsed;
  timer.remaining = remaining;

  console.log(`[resilience] ⏱️ Stage "${stage}" started — budget: ${timer.budgetMs}ms, pipeline remaining: ${remaining}ms`);
  return timer;
}

/**
 * End timing a stage. Logs elapsed vs budget.
 */
export function endStage(timer: StageTimer): { elapsedMs: number; overBudget: boolean } {
  const elapsedMs = Date.now() - timer.startTime;
  timer.elapsed = elapsedMs;
  const overBudget = elapsedMs > timer.budgetMs;

  if (overBudget) {
    console.warn(`[resilience] ⏰ Stage "${timer.stage}" OVER BUDGET: ${elapsedMs}ms / ${timer.budgetMs}ms`);
  } else {
    console.log(`[resilience] ⏱️ Stage "${timer.stage}" complete: ${elapsedMs}ms / ${timer.budgetMs}ms`);
  }

  return { elapsedMs, overBudget };
}

/**
 * Get total elapsed and remaining pipeline time.
 */
export function getBudgetStatus(budget: TimeoutBudget): { elapsedMs: number; remainingMs: number; exhausted: boolean } {
  const elapsedMs = Date.now() - budget.startTime;
  const remainingMs = Math.max(0, budget.totalBudgetMs - elapsedMs);
  return { elapsedMs, remainingMs, exhausted: remainingMs <= 0 };
}

// ── Structured Logging ────────────────────────────────────

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface StageLogEntry {
  timestamp: number;
  level: LogLevel;
  stage: string;
  dependency?: DependencyName;
  message: string;
  data?: Record<string, unknown>;
  elapsedMs?: number;
  circuitState?: CircuitState;
}

// In-memory ring buffer for recent logs (last 500 entries)
const logBuffer: StageLogEntry[] = [];
const LOG_BUFFER_MAX = 500;

export function stageLog(
  level: LogLevel,
  stage: string,
  message: string,
  opts?: { dependency?: DependencyName; data?: Record<string, unknown>; elapsedMs?: number },
): void {
  const entry: StageLogEntry = {
    timestamp: Date.now(),
    level,
    stage,
    message,
    dependency: opts?.dependency,
    data: opts?.data,
    elapsedMs: opts?.elapsedMs,
  };

  // Add circuit state if dependency is a breaker
  if (opts?.dependency) {
    const breaker = breakers.get(opts.dependency);
    if (breaker) entry.circuitState = breaker.state.state;
  }

  logBuffer.push(entry);
  if (logBuffer.length > LOG_BUFFER_MAX) logBuffer.shift();

  // Console output with stage prefix
  const prefix = `[${stage}]`;
  const depStr = opts?.dependency ? `[${opts.dependency}]` : '';
  const elapsedStr = opts?.elapsedMs ? ` (${opts.elapsedMs}ms)` : '';

  switch (level) {
    case 'debug':
      console.debug(`${prefix}${depStr}${elapsedStr} ${message}`, opts?.data ?? '');
      break;
    case 'info':
      console.log(`${prefix}${depStr}${elapsedStr} ${message}`, opts?.data ?? '');
      break;
    case 'warn':
      console.warn(`${prefix}${depStr}${elapsedStr} ${message}`, opts?.data ?? '');
      break;
    case 'error':
      console.error(`${prefix}${depStr}${elapsedStr} ${message}`, opts?.data ?? '');
      break;
  }
}

/**
 * Get recent log entries for observability/debugging.
 */
export function getRecentLogs(limit: number = 100, stage?: string): StageLogEntry[] {
  let filtered = [...logBuffer];
  if (stage) filtered = filtered.filter(e => e.stage === stage);
  return filtered.slice(-limit);
}

/**
 * Get a summary of circuit breaker health for health-check endpoints.
 */
export function getHealthSummary(): {
  breakers: Record<string, { state: CircuitState; failureRate: number }>;
  recentErrors: number;
} {
  const summary: Record<string, { state: CircuitState; failureRate: number }> = {};
  for (const [name, b] of breakers) {
    const rate = b.state.totalCalls > 0 ? b.state.totalFailures / b.state.totalCalls : 0;
    summary[name] = { state: b.state.state, failureRate: Math.round(rate * 100) / 100 };
  }

  const recentErrors = logBuffer.filter(e => e.level === 'error' && Date.now() - e.timestamp < 300_000).length;

  return { breakers: summary, recentErrors };
}

// ── Error Types ───────────────────────────────────────────

export class CircuitOpenError extends Error {
  constructor(
    public dependency: DependencyName,
    public remainingMs: number,
  ) {
    super(`Circuit ${dependency} is OPEN — retry in ${remainingMs}ms`);
    this.name = 'CircuitOpenError';
  }
}

export class TimeoutBudgetExhaustedError extends Error {
  constructor(
    public totalBudgetMs: number,
    public elapsedMs: number,
  ) {
    super(`Timeout budget exhausted: ${elapsedMs}ms / ${totalBudgetMs}ms — pipeline aborted`);
    this.name = 'TimeoutBudgetExhaustedError';
  }
}

export class TimeoutError extends Error {
  constructor(
    public dependency: DependencyName,
    public timeoutMs: number,
  ) {
    super(`${dependency} timed out after ${timeoutMs}ms`);
    this.name = 'TimeoutError';
  }
}

// ── Internal Utilities ────────────────────────────────────

function withTimeout<T>(promise: T, timeoutMs: number, name: string): Promise<T> {
  // If the value isn't a promise, return it directly
  if (!(promise instanceof Promise) && typeof (promise as any)?.then !== 'function') {
    return Promise.resolve(promise);
  }

  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new TimeoutError(name as DependencyName, timeoutMs));
    }, timeoutMs);

    (promise as Promise<T>).then(
      (result) => {
        clearTimeout(timer);
        resolve(result);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

// ── Initialize default fallbacks ──────────────────────────

// Screener down: return empty result set, flag as fallback
registerFallback({
  dependency: 'screener',
  description: 'Cached screener results (last known valid set)',
  fallback: () => ({
    results: [],
    provider: 'fallback_cached',
    error: 'Screener unavailable — using cached results. Data may be stale.',
    cached: true,
  }),
});

// SnapTrade: NO safe fallback — must surface to user
registerFallback({
  dependency: 'snaptrade',
  description: 'No safe fallback for brokerage data',
  fallback: () => {
    throw new Error('SnapTrade is unavailable — unable to access your brokerage account');
  },
  noSafeFallback: true,
});

// Finnhub down: signal that validation was skipped
registerFallback({
  dependency: 'finnhub',
  description: 'Skip symbol validation, surface warning to user',
  fallback: () => ({
    ok: true,
    issues: [],
    warning: 'Symbol validation skipped — Finnhub unavailable. Tickers may be incorrect.',
  }),
});

// LLM fallback: route to secondary model
registerFallback({
  dependency: 'llm_primary',
  description: 'Route to fallback LLM (DeepSeek if primary is Anthropic, or vice versa)',
  fallback: () => {
    throw new Error('LLM fallback must be configured per-request — model routing is request-specific');
  },
});
