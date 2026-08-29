// Shared "is this phrased as a question / hypothetical, not a command?" detector.
//
// The gpt-5-nano classifier frequently labels read-only questions as
// profile_mutation ("should I be more conservative?", "am I too aggressive?",
// "is my risk tolerance too high?"). Profile mutation is a side effect, so any
// message that merely looks like a question must NOT mutate — it should fall
// through to the model for a plain answer instead.
//
// Commands ("change my style to Lynch", "make me more aggressive") use
// imperative verbs and never contain these question leads, so broad matching
// here is safe for the profile-mutation gate.

const LEADS =
  /^(?:what'?s?|wuts?|wats?|when|how|why|who|where|which|did|does|is|are|was|were|should|could|would|might|may|shall|will|can)\b/i;

const PHRASES =
  /\b(?:what if|what happens if|what would happen if|how would|how do i|how to|how should|right for me|am i|are my|is my|is this|is that|is it|do i|do you|do we|have i|have you|can i|could i|should i|would i|does my|did my)\b/i;

export function isQuestionLike(message: string): boolean {
  const m = message.trim();
  if (!m) return false;
  if (/[?]$/.test(m)) return true;
  if (LEADS.test(m)) return true;
  if (PHRASES.test(m)) return true;
  return false;
}
