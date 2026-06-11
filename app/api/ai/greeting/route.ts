import Anthropic from '@anthropic-ai/sdk'
import { NextRequest, NextResponse } from 'next/server'

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
  defaultHeaders: {
    'anthropic-beta': 'prompt-caching-2024-07-31',
  },
})

const GREETING_SYSTEM_PROMPT = `You are Vantage AI. Generate a personalized
2-sentence greeting using the user's actual portfolio
data. Reference a specific ticker, today's P&L, or
an upcoming event. Be direct and specific. Never
mention Claude or Anthropic. No markdown.`;

export async function POST(req: NextRequest) {
  try {
    const { portfolioContext } = await req.json()

    const userMessage = `Generate my greeting. Portfolio context:
${portfolioContext || 'No portfolio data available'}`

    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
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
    console.error('Greeting generation error:', error)
    return NextResponse.json(
      { error: error?.message || 'Failed to generate greeting' },
      { status: 500 }
    )
  }
}
