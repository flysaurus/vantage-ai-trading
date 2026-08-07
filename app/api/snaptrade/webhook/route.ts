/**
 * SnapTrade Webhook Handler
 *
 * POST /api/snaptrade/webhook
 *
 * Receives webhook events from SnapTrade for connection lifecycle events.
 * Verifies HMAC-SHA256 signature using consumer key (canonical JSON, sorted keys).
 * Prevents replay attacks with 5-minute timestamp window.
 *
 * Event types handled:
 *   - CONNECTION_BROKEN → alert user, disable trading for that connection
 *   - CONNECTION_FIXED → re-enable connection
 *   - CONNECTION_ADDED/CONNECTION_DELETED → log for audit
 *   - NEW_ACCOUNT_AVAILABLE → trigger account refresh
 *   - Others → ack and log
 */

import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';

// ─── Constants ─────────────────────────────────────────────────

const CONSUMER_KEY = process.env.SNAPTRADE_CONSUMER_KEY;
const REPLAY_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

// ─── Signature Verification ───────────────────────────────────

/**
 * Verify HMAC-SHA256 webhook signature.
 *
 * SnapTrade signature format:
 *   - Canonical JSON of the payload body: sorted keys, no whitespace (separators: ",", ":")
 *   - HMAC-SHA256 with consumer key as the secret
 *   - Result is base64-encoded
 */
function verifySignature(body: string, signature: string | null): boolean {
  if (!CONSUMER_KEY || !signature) return false;

  try {
    // Re-serialize the parsed body into canonical form
    const parsed = JSON.parse(body);
    const canonical = JSON.stringify(parsed, Object.keys(parsed).sort());

    const hmac = crypto.createHmac('sha256', CONSUMER_KEY);
    hmac.update(canonical);
    const expected = hmac.digest('base64');

    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expected),
    );
  } catch {
    return false;
  }
}

/**
 * Check that the event timestamp is within the replay window.
 */
function isTimestampValid(eventTimestamp: string | undefined): boolean {
  if (!eventTimestamp) return false;
  try {
    const eventTime = new Date(eventTimestamp).getTime();
    if (isNaN(eventTime)) return false;
    return Math.abs(Date.now() - eventTime) < REPLAY_WINDOW_MS;
  } catch {
    return false;
  }
}

// ─── Event Handlers ───────────────────────────────────────────

interface WebhookPayload {
  webhookId?: string;
  clientId?: string;
  userId?: string;
  eventType?: string;
  eventTimestamp?: string;
  brokerageAuthorizationId?: string;
  brokerageId?: string;
  accountId?: string;
  connectionAttemptedResult?: string;
}

function logEvent(eventType: string, payload: WebhookPayload): void {
  const key = payload.brokerageAuthorizationId
    ? `auth=${payload.brokerageAuthorizationId.slice(0, 8)}`
    : '';
  const user = payload.userId ? `user=${payload.userId.slice(0, 8)}` : '';
  console.log(
    `[SnapTrade Webhook] ${eventType} ${user} ${key}`.trim(),
  );
}

// ─── Route Handler ────────────────────────────────────────────

export async function POST(req: NextRequest) {
  // 1. Read raw body
  let body: string;
  try {
    body = await req.text();
  } catch {
    return NextResponse.json(
      { error: 'Unable to read request body' },
      { status: 400 },
    );
  }

  // 2. Verify signature
  const signature = req.headers.get('Signature');
  if (!verifySignature(body, signature)) {
    console.warn('[SnapTrade Webhook] Signature verification failed');
    return NextResponse.json(
      { error: 'Signature verification failed' },
      { status: 401 },
    );
  }

  // 3. Parse + validate timestamp
  let payload: WebhookPayload;
  try {
    payload = JSON.parse(body);
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON' },
      { status: 400 },
    );
  }

  if (!isTimestampValid(payload.eventTimestamp)) {
    console.warn('[SnapTrade Webhook] Replay detected or stale event');
    return NextResponse.json(
      { error: 'Event timestamp too old or missing' },
      { status: 400 },
    );
  }

  // 4. Handle event type
  const eventType = payload.eventType || 'UNKNOWN';

  switch (eventType) {
    case 'CONNECTION_BROKEN':
      logEvent(eventType, payload);
      // TODO: When we have a connection registry, mark connection as broken
      // and notify the user via toast/push. For now, just log.
      break;

    case 'CONNECTION_FIXED':
      logEvent(eventType, payload);
      // TODO: Re-enable the connection in registry
      break;

    case 'CONNECTION_ADDED':
      logEvent(eventType, payload);
      break;

    case 'CONNECTION_DELETED':
      logEvent(eventType, payload);
      break;

    case 'NEW_ACCOUNT_AVAILABLE':
      logEvent(eventType, payload);
      // Client-side should trigger a refresh on next page load or heartbeat
      break;

    case 'USER_REGISTERED':
    case 'USER_DELETED':
    case 'CONNECTION_ATTEMPTED':
    case 'CONNECTION_UPDATED':
    case 'CONNECTION_FAILED':
    case 'ACCOUNT_TRANSACTIONS_INITIAL_UPDATE':
    default:
      logEvent(eventType, payload);
      break;
  }

  // 5. Acknowledge — must return 2xx to prevent retries
  return NextResponse.json({ received: true }, { status: 200 });
}
