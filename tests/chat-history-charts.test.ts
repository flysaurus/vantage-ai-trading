// Chat chart persistence — a resolved chart must survive a reload.
//
// The live SSE `charts` event is NOT persisted with the message, so a reloaded
// chat used to lose every chart. The payload is now stored in
// `chat_messages.metadata.charts` and replayed through `toDBChatMessage()`.
// These tests pin: (1) charts come back, (2) an absent/empty/malformed
// metadata NEVER invents a chart, (3) role normalisation is unchanged.
import { describe, it, expect } from 'vitest';
import { toDBChatMessage } from '@/lib/chat-history-db';

const chart = {
  type: 'waterfall',
  key: 'pnl-waterfall',
  title: 'P&L bridge',
  data: { steps: [{ label: 'Current value', delta: 100 }] },
};

const row = (over: any = {}) => ({
  id: 'm1',
  user_id: 'u1',
  role: 'assistant',
  content: 'Here is your bridge.',
  created_at: '2026-09-17T18:00:00Z',
  metadata: null,
  ...over,
});

describe('toDBChatMessage — chart replay', () => {
  it('replays charts persisted in metadata', () => {
    const m = toDBChatMessage(row({ metadata: { charts: [chart] } }));
    expect(m.charts).toHaveLength(1);
    expect(m.charts![0]).toMatchObject({ type: 'waterfall', key: 'pnl-waterfall' });
    expect(m.content).toBe('Here is your bridge.');
    expect(m.role).toBe('ai');
  });

  it('replays multiple charts in order', () => {
    const a = { ...chart, key: 'a' };
    const b = { ...chart, key: 'b' };
    const m = toDBChatMessage(row({ metadata: { charts: [a, b] } }));
    expect((m.charts as any[]).map((c) => c.key)).toEqual(['a', 'b']);
  });

  it('missing metadata ⇒ no charts (never invented)', () => {
    expect(toDBChatMessage(row()).charts).toBeNull();
  });

  it('empty charts array ⇒ no charts, not an empty render block', () => {
    expect(toDBChatMessage(row({ metadata: { charts: [] } })).charts).toBeNull();
  });

  it('malformed charts value ⇒ no charts', () => {
    expect(toDBChatMessage(row({ metadata: { charts: 'nope' } })).charts).toBeNull();
    expect(toDBChatMessage(row({ metadata: { charts: null } })).charts).toBeNull();
    expect(toDBChatMessage(row({ metadata: { charts: {} } })).charts).toBeNull();
    expect(toDBChatMessage(row({ metadata: 'broken' })).charts).toBeNull();
  });

  it('other metadata keys are ignored for charts', () => {
    expect(toDBChatMessage(row({ metadata: { download: { rows: [] } } })).charts).toBeNull();
  });

  it('normalises roles (assistant|ai ⇒ ai, user ⇒ user)', () => {
    expect(toDBChatMessage(row({ role: 'assistant' })).role).toBe('ai');
    expect(toDBChatMessage(row({ role: 'ai' })).role).toBe('ai');
    expect(toDBChatMessage(row({ role: 'user' })).role).toBe('user');
  });

  it('keeps id + createdAt and tolerates a null content', () => {
    const m = toDBChatMessage(row({ content: null }));
    expect(m.id).toBe('m1');
    expect(m.createdAt).toBe('2026-09-17T18:00:00Z');
    expect(m.content).toBe('');
  });
});
