import Anthropic from '@anthropic-ai/sdk'
import { NextRequest, NextResponse } from 'next/server'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

export async function POST(req: NextRequest) {
  try {
    const { portfolioContext } = await req.json()

    const systemPrompt = `You are Vantage AI. Generate a personalized
2-sentence greeting using the user's actual portfolio
data. Reference a specific ticker, today's P&L, or
an upcoming event. Be direct and specific. Never
mention Claude or Anthropic. No markdown.`

    const userMessage = `Generate my greeting. Portfolio context:
${portfolioContext || 'No portfolio data available'}`

    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 200,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }]
    })

    const text = (response.content as any[])
      .map((block: any) => block.type === 'text' ? block.text : '')
      .join('')
      .trim()

    return NextResponse.json({ greeting: text })
  } catch (error: any) {
    console.error('Greeting generation error:', error)
    return NextResponse.json(
      { error: error?.message || 'Failed to generate greeting' },
      { status: 500 }
    )
  }
}
