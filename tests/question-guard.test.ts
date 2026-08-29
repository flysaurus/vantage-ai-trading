import { describe, it, expect } from 'vitest';
import { isQuestionLike } from '../lib/ai/question-guard';

describe('isQuestionLike', () => {
  // The gpt-5-nano probe found these questions mislabeled as profile_mutation.
  // Every one must be guarded so a question never mutates the profile.
  const questions = [
    'should i switch to growth style',
    'should i be more conservative',
    'should i change my risk tolerance',
    'am i too aggressive right now',
    'am i too conservative for my age',
    'is my risk tolerance too high',
    'is growth style right for me',
    'should i switch my investing style',
    'should i dial back my aggressiveness',
    'should i update my risk profile',
    'am i too passive with my strategy',
    'am i in the right risk category',
    'should i be taking on more risk',
    'what if i went all in on tech?',
    'how do i know if my risk is right',
    'is it a good idea to be aggressive',
  ];

  it.each(questions)('guards question: %s', (q) => {
    expect(isQuestionLike(q)).toBe(true);
  });

  const commands = [
    'change my style to Lynch',
    'make me more aggressive',
    'switch to Buffett',
    'set my risk to conservative',
    'change my investing style to lynch',
    'rebalance my portfolio',
    'update my risk to moderate',
    'make it aggressive',
  ];

  it.each(commands)('allows command: %s', (c) => {
    expect(isQuestionLike(c)).toBe(false);
  });
});
