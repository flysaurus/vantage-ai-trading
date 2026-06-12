import Anthropic from '@anthropic-ai/sdk'
import { NextRequest, NextResponse } from 'next/server'
import { buildUserProfileContext } from '@/lib/ai/userProfile'
import type { UserProfile } from '@/lib/ai/userProfile'

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
  defaultHeaders: {
    'anthropic-beta': 'prompt-caching-2024-07-31',
  },
})

const GREETING_SYSTEM_PROMPT = `You are Vantage AI. Generate a personalized
2-sentence greeting using the user's actual portfolio
data. Reference a specific ticker, today's P&L, or
an upcoming event. Match the user's investor style
and risk tolerance in tone. Be direct and specific.
Never mention Claude or Anthropic. No markdown.`;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { portfolioContext } = body

    // Build user profile context from request body
    const profile: UserProfile = {
      investorStyle: body.investorStyle || 'Lynch',
      riskTolerance: body.riskTolerance || 'Moderate',
      name: body.name || 'M',
    }
    const profileContext = buildUserProfileContext(profile)

    console.log('[Greeting] key:', !!process.env.ANTHROPIC_API_KEY)
    console.log('[Greeting] model: claude-haiku-4-5-20251001')
    console.log('[Greeting] profile:', JSON.stringify({ style: profile.investorStyle, risk: profile.riskTolerance }))

    const userMessage = `Generate my greeting. Portfolio context:
${portfolioContext || 'No portfolio data available'}

${profileContext}`

    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 200,
      system: [
        {
          type: 'text' as const,
          text: GREETING_SYSTEM_PROMPT,
          cache_control: { type: 'ephemeral' as const },
        },
      ],
      messages: [{ role: 'user', content: userMessage }]
    })

    const text = (response.content as any[])
      .map((block: any) => block.type === 'text' ? block.text : '')
      .join('')
      .trim()

    // Log cache metrics
    const usage = (response as any).usage || {};
    console.log('[Cache]', JSON.stringify({
      route: 'greeting',
      inputTokens: usage.input_tokens,
      cacheCreationTokens: usage.cache_creation_input_tokens || 0,
      cacheReadTokens: usage.cache_read_input_tokens || 0,
      outputTokens: usage.output_tokens,
      cacheHit: (usage.cache_read_input_tokens || 0) > 0,
    }));

    return NextResponse.json({ greeting: text })
  } catch (error: any) {
    console.error('[Greeting] Error:', error?.message || error)
    console.error('[Greeting] Status:', error?.status || 'unknown')
    console.error('[Greeting] Full:', JSON.stringify(error, Object.getOwnPropertyNames(error)))
    return NextResponse.json(
      { error: error?.message || 'Failed to generate greeting' },
      { status: 500 }
    )
  }
}
