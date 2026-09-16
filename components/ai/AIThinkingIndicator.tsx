'use client';
// ─── Thinking status (item 8) ───────────────────────────────
// ONE line, reflecting what the server is ACTUALLY doing.
//
// This used to cycle a fixed list of canned phrases on a 2000ms timer keyed by
// "mode" (health / research / opportunities / …). That was fake progress: the
// phrases were invented client-side and had no relationship to the request in
// flight, so they could claim "Calculating risk scores" while the server was
// doing something else entirely.
//
// The label now comes from real server stage events (`status` SSE events,
// emitted by sendStatus() in app/api/chat/route.ts at genuine boundaries — model
// generation, and each tool the model actually invokes). The caller passes the
// current label; there is no timer and no fallback phrase list here.
import CompassIcon from '@/components/CompassIcon';

export default function AIThinkingIndicator({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 px-4 py-2">
      <CompassIcon size={22} color="white" animated={true} />
      <p className="text-slate-300 text-sm" data-testid="thinking-status-line">
        {label}
      </p>
    </div>
  );
}
