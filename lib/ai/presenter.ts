// ─── AI Advisor Presenter ──────────────────────────────────────
// Phase 5: Unified streaming presenter.
//
// Owns:
// - Dynamic checklist events driven by real stage completion
// - SSE stream construction for progressive rendering
// - Token-budget tracking with abort on overrun
// - Marker-stripping guarantee (CLARIFY responses must never carry RECOMMEND)
//
// Principle: no render until validation passes.
// ──────────────────────────────────────────────────────────────────

export type ChecklistStage =
  | 'intent_classified'
  | 'screening_ran'
  | 'portfolio_context_built'
  | 'recommendations_built'
  | 'marker_format'
  | 'coherence_check'
  | 'symbol_verification'
  | 'budget_reconciliation'
  | 'final_render';

export type ChecklistStatus = 'pending' | 'in_progress' | 'done' | 'failed' | 'skipped';

export interface ChecklistEvent {
  stage: ChecklistStage;
  status: ChecklistStatus;
  detail?: string;
  timestamp: number;
}

export interface PresenterState {
  checklist: Map<ChecklistStage, ChecklistStatus>;
  stageOrder: ChecklistStage[];
  totalTokens: number;
  tokenLimit: number;
  startTime: number;
}

/**
 * Create a fresh presenter state for a new generation.
 */
export function createPresenterState(tokenLimit: number = 25000): PresenterState {
  return {
    checklist: new Map(),
    stageOrder: [
      'intent_classified',
      'screening_ran',
      'portfolio_context_built',
      'recommendations_built',
      'marker_format',
      'coherence_check',
      'symbol_verification',
      'budget_reconciliation',
      'final_render',
    ],
    totalTokens: 0,
    tokenLimit,
    startTime: Date.now(),
  };
}

/**
 * Emit a checklist progress event.
 * Called as each stage completes (or fails) during generation.
 */
export function emitChecklist(
  controller: ReadableStreamDefaultController,
  encoder: TextEncoder,
  state: PresenterState,
  stage: ChecklistStage,
  status: ChecklistStatus,
  detail?: string,
): void {
  state.checklist.set(stage, status);
  const event: ChecklistEvent = {
    stage,
    status,
    detail,
    timestamp: Date.now(),
  };
  controller.enqueue(
    encoder.encode(`data: ${JSON.stringify({ checklist: event })}\n\n`),
  );
}

/**
 * Track token consumption. Aborts the stream if token limit is exceeded.
 *
 * Returns true if the stream should continue, false if it was aborted.
 */
export function trackTokens(
  controller: ReadableStreamDefaultController,
  encoder: TextEncoder,
  state: PresenterState,
  newTokens: number,
): boolean {
  state.totalTokens += newTokens;
  if (state.totalTokens > state.tokenLimit) {
    console.warn(`[presenter] ⚠️ Token limit exceeded: ${state.totalTokens}/${state.tokenLimit}`);
    controller.enqueue(
      encoder.encode(
        `data: ${JSON.stringify({ error: 'token_limit_exceeded', used: state.totalTokens, limit: state.tokenLimit })}\n\n`,
      ),
    );
    controller.close();
    return false;
  }
  return true;
}

/**
 * Strip RECOMMEND markers from CLARIFY responses.
 *
 * CLARIFY responses are information-gathering only — they must never carry
 * actionable [RECOMMEND:...] markers. This is a hard guarantee.
 */
export function sanitizeClarifyResponse(text: string): { text: string; stripped: number } {
  if (!/\[CLARIFY:/.test(text)) return { text, stripped: 0 };

  const matches = text.match(/\[RECOMMEND:[^\]]*\]/g);
  const stripped = matches ? matches.length : 0;

  if (stripped > 0) {
    console.warn(`[presenter] ⚠️ Stripped ${stripped} RECOMMEND markers from CLARIFY response`);
    return { text: text.replace(/\[RECOMMEND:[^\]]*\]/g, ''), stripped };
  }

  return { text, stripped: 0 };
}

/**
 * Determine whether marker presence is sufficient for rendering trade buttons.
 */
export function analyzeMarkerPresence(text: string): {
  hasBuyMarkers: boolean;
  hasSellMarkers: boolean;
  hasPortfolioBlocks: boolean;
  hasClarifyBlocks: boolean;
  markerCount: number;
} {
  const buyRe = /\[RECOMMEND:[A-Z]{1,5}(?:\.[A-Z]{1,2})?:BUY:\$?[\d,]+\]/i;
  const sellRe = /\[RECOMMEND:[A-Z]{1,5}(?:\.[A-Z]{1,2})?:SELL/i;
  const portfolioRe = /\[PORTFOLIO:\{/i;
  const clarifyRe = /\[CLARIFY:/i;

  const buyMarkers = text.match(new RegExp(buyRe.source, 'gi')) || [];
  const sellMarkers = text.match(new RegExp(sellRe.source, 'gi')) || [];

  return {
    hasBuyMarkers: buyMarkers.length > 0,
    hasSellMarkers: sellMarkers.length > 0,
    hasPortfolioBlocks: portfolioRe.test(text),
    hasClarifyBlocks: clarifyRe.test(text),
    markerCount: buyMarkers.length + sellMarkers.length,
  };
}

/**
 * Build the elapsed time string for the final event.
 */
export function getElapsedMs(state: PresenterState): number {
  return Date.now() - state.startTime;
}
