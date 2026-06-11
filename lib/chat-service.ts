'use client';

/**
 * Chat service — Supabase-backed chat history with 7-day retention.
 *
 * Uses chat_messages table for message storage and ai_usage table
 * for daily message counts (replaces localStorage-only counting).
 */

import { createClient } from '@/lib/supabase';

const MAX_MESSAGES_PER_DAY = 25;

export interface ChatMessageRow {
  id: string;
  user_id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
}

// ─── Message persistence ───

/** Save a single message to Supabase, auto-cleaning old messages */
export async function saveChatMessage(
  userId: string,
  role: 'user' | 'assistant',
  content: string,
): Promise<string> {
  const supabase = createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.rpc as any)('insert_chat_message', {
    p_user_id: userId,
    p_role: role,
    p_content: content,
  });

  if (error) {
    console.error('[chat-service] Failed to save message:', error);
    throw error;
  }

  return data as string;
}

/** Save multiple messages in bulk */
export async function saveChatMessages(
  userId: string,
  messages: { role: 'user' | 'assistant'; content: string }[],
): Promise<void> {
  for (const msg of messages) {
    await saveChatMessage(userId, msg.role, msg.content).catch(console.error);
  }
}

// ─── Message loading ───

/** Fetch messages for today's date */
export async function fetchTodayMessages(
  userId: string,
): Promise<ChatMessageRow[]> {
  const supabase = createClient();
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from('chat_messages')
    .select('*')
    .eq('user_id', userId)
    .gte('created_at', today.toISOString())
    .order('created_at', { ascending: true });

  if (error) {
    console.error('[chat-service] Failed to fetch today messages:', error);
    return [];
  }

  return data || [];
}

/** Fetch messages from last session (most recent before today) */
export async function fetchLastSession(
  userId: string,
): Promise<ChatMessageRow[]> {
  const supabase = createClient();
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Get the most recent message date before today
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: lastDates, error: dateError } = await (supabase as any)
    .from('chat_messages')
    .select('created_at')
    .eq('user_id', userId)
    .lt('created_at', today.toISOString())
    .order('created_at', { ascending: false })
    .limit(1);

  if (dateError || !lastDates || lastDates.length === 0) return [];

  const lastDate = new Date(lastDates[0].created_at);
  const startOfLastDay = new Date(lastDate);
  startOfLastDay.setHours(0, 0, 0, 0);
  const endOfLastDay = new Date(lastDate);
  endOfLastDay.setHours(23, 59, 59, 999);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from('chat_messages')
    .select('*')
    .eq('user_id', userId)
    .gte('created_at', startOfLastDay.toISOString())
    .lte('created_at', endOfLastDay.toISOString())
    .order('created_at', { ascending: true });

  if (error) {
    console.error('[chat-service] Failed to fetch last session:', error);
    return [];
  }

  return data || [];
}

// ─── Daily message counts (Supabase-backed, survives browser clears) ───

/** Get today's message count from Supabase */
export async function getTodaysMessageCount(userId: string): Promise<number> {
  const supabase = createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.rpc as any)('get_todays_message_count', {
    p_user_id: userId,
  });

  if (error) {
    console.error('[chat-service] Failed to get message count:', error);
    return 0;
  }

  return (data as number) || 0;
}

/** Check if user has remaining messages today */
export async function hasMessagesRemaining(userId: string): Promise<boolean> {
  const count = await getTodaysMessageCount(userId);
  return count < MAX_MESSAGES_PER_DAY;
}

/** Get remaining message count */
export async function getRemainingMessages(userId: string): Promise<number> {
  const count = await getTodaysMessageCount(userId);
  return Math.max(0, MAX_MESSAGES_PER_DAY - count);
}

// ─── Cleanup ───

/** Delete all messages for a user older than 7 days */
export async function cleanupOldMessages(userId: string): Promise<void> {
  const supabase = createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.rpc as any)('cleanup_old_chat_messages', {
    p_user_id: userId,
  });

  if (error) {
    console.error('[chat-service] Failed to clean old messages:', error);
  }
}

/** Clear today's chat messages (user-triggered) */
export async function clearTodayMessages(userId: string): Promise<void> {
  const supabase = createClient();
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any)
    .from('chat_messages')
    .delete()
    .eq('user_id', userId)
    .gte('created_at', today.toISOString());

  if (error) {
    console.error('[chat-service] Failed to clear messages:', error);
  }
}
