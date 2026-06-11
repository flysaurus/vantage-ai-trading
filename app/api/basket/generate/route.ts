import Anthropic from '@anthropic-ai/sdk'
import { NextRequest, NextResponse } from 'next/server'

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
  defaultHeaders: {
    'anthropic-beta': 'prompt-caching-2024-07-31',
  },
})

const BASKET_SYSTEM_PROMPT = `You are Vantage AI, a portfolio construction expert.
Generate a thematic investment basket.
Return ONLY valid JSON, no markdown, no explanation.

Format:
{
  "theme": "theme name",
  "rationale": "2 sentence explanation of why these stocks fit the theme",
  "stocks": [
    {
      "symbol": "TICKER",
      "name": "Company Name",
      "allocation": 20,
      "rationale": "one line why this stock fits the theme"
    }
  ]
}

Rules:
- 5 to 8 stocks
- allocations must sum to exactly 100
- use only US-listed stocks with high liquidity
- weight toward highest conviction picks
- prefer stocks actually related to the theme`

export async function POST(req: NextRequest) {
  try {
    const { theme, budget } = await req.json()

    if (!theme) {
      return NextResponse.json({ error: 'Theme required' }, { status: 400 })
    }

    const budgetNum = budget ? parseInt(String(budget)) : 10000

    const message = `Build a ${theme} basket with $${budgetNum.toLocaleString()} budget. Include 6-8 high-conviction US stocks that best represent this theme.`

    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: [
        {
          type: 'text' as const,
          text: BASKET_SYSTEM_PROMPT,
          cache_control: { type: 'ephemeral' as const },
        },
      ],
      messages: [{ role: 'user', content: message }]
    })

    // Extract JSON from response
    const text = (response.content as any[])
      .map((block: any) => block.type === 'text' ? block.text : '')
      .join('')

    // Log cache metrics
    const usage = (response as any).usage || {};
    console.log('[Cache]', JSON.stringify({
      route: 'basket-generate',
      inputTokens: usage.input_tokens,
      cacheCreationTokens: usage.cache_creation_input_tokens || 0,
      cacheReadTokens: usage.cache_read_input_tokens || 0,
      outputTokens: usage.output_tokens,
      cacheHit: (usage.cache_read_input_tokens || 0) > 0,
    }));

    // Find JSON object in the text
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      return NextResponse.json({ error: 'Failed to parse AI response', raw: text }, { status: 500 })
    }

    const data = JSON.parse(jsonMatch[0])

    // Validate structure
    if (!data.stocks || !Array.isArray(data.stocks) || data.stocks.length === 0) {
      return NextResponse.json({ error: 'Invalid basket structure', data }, { status: 500 })
    }

    return NextResponse.json(data)
  } catch (error: any) {
    console.error('Basket generation error:', error)
    return NextResponse.json(
      { error: error?.message || 'Failed to generate basket' },
      { status: 500 }
    )
  }
}
