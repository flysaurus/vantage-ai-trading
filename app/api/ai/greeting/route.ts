import Anthropic from '@anthropic-ai/sdk'
import { NextRequest, NextResponse } from 'next/server'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

export async function POST(req: NextRequest) {
  try {
    const { portfolioContext } = await req.json()

    const systemPrompt = `Generate a single short greeting for the user.
2-3 sentences max. Reference their actual portfolio
performance today and one specific actionable prompt.
Be direct, personal, and specific — not generic.
Example style: 'Good evening M. META dragged your
portfolio down 2.1% today — part of a broader tech
selloff. ADBE reports earnings tomorrow, want me to
run the numbers?'
Use real portfolio context provided.
Never mention Claude or Anthropic.`

    const userMessage = `Portfolio context:\n${portfolioContext || 'No portfolio data available'}\n\nGenerate a short, personal greeting based on this data. Reference today's P&L, any notable movers, and suggest one actionable next step.`

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
