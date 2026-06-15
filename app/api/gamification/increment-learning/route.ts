// ─── Gamification: Increment Learning XP ────────────────────
// POST /api/gamification/increment-learning
// Awards XP when user completes a Learning Moment card.
//
// Body: { anonymousId: string, xpAmount: number }

import { NextRequest, NextResponse } from 'next/server';
import { addLearningXP } from '@/app/actions/gamification';

export async function POST(request: NextRequest) {
  try {
    const { anonymousId, xpAmount } = await request.json();

    if (!anonymousId) {
      return NextResponse.json(
        { error: 'Missing anonymousId' },
        { status: 400 }
      );
    }

    const result = await addLearningXP(anonymousId, Number(xpAmount) || 2);

    if (!result.success) {
      return NextResponse.json(
        { error: 'Failed to award XP' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      newScore: result.newScore,
    });
  } catch (err: any) {
    console.error('[api/gamification/increment-learning] Error:', err.message);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
