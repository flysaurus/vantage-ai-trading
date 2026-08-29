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

// "Is this phrased as a leaning / preference, not a clear command?"
//
// The deterministic account-action router handles real commands ("make me more
// conservative") BEFORE the classifier. Anything that reaches the Tier-2
// profile_mutation gate has already failed the deterministic command matcher —
// so a message that ALSO reads as a hedge or a preference ("I think I want to be
// more conservative", "conservative sounds better for me") must NOT be silently
// mutated. It should fall through to the model for a clarifying question instead.
const HEDGES =
  /\b(i\s+think|i\s+guess|i\s+suppose|i\s+feel\s+(?:like|that)?|i'?m\s+(?:thinking|leaning|considering|not\s+sure)|not\s+sure|maybe|perhaps|probably|possibly|i\s+might|i\s+may|kinda|sort\s+of|i\s+reckon|i\s+wonder|i\s+want\s+to\s+be|i'?d\s+like\s+to\s+be)\b/i;

const PREFERENCES =
  /\b(?:sounds?|looks?|feels?|seems?)\s+(?:better|good|right|nice|best|safer|wiser|like\s+a\s+good\s+idea)\b|\bwould\s+be\s+(?:better|good|nice|safer)\b|\bi'?m\s+leaning\s+(?:toward|towards|to)\b/i;

export function isHesitant(message: string): boolean {
  const m = message.trim();
  if (!m) return false;
  if (HEDGES.test(m)) return true;
  if (PREFERENCES.test(m)) return true;
  return false;
}
