import Anthropic from '@anthropic-ai/sdk'
import { VANTAGE_SYSTEM_PROMPT, ALERTS_SYSTEM_PROMPT } from '@/lib/ai-system-prompt'
import type { SystemBlock } from '@/lib/ai-provider'
import { buildUserProfileContext } from '@/lib/ai/userProfile'
import type { UserProfile } from '@/lib/ai/userProfile'
import { checkUsageLimit, incrementUsage } from '@/lib/ai-guard'
import { getOptionalUserId } from '@/lib/auth/get-server-user'

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
  defaultHeaders: {
    'anthropic-beta': 'prompt-caching-2024-07-31',
  },
})
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY
const SEARXNG_URL = process.env.SEARXNG_URL || 'http://localhost:8888'

// ─── Stage 0: DeepSeek Screening ───
async function screenMessage(userMessage: string): Promise<{
  needsSearch: boolean
  searchQuery: string | null
  queryType: 'portfolio' | 'market_research' | 'general_finance'
}> {
  try {
    const res = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${DEEPSEEK_API_KEY}`
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        max_tokens: 100,
        messages: [{
          role: 'user',
          content: `Classify this finance question. Reply with JSON only:
{
  "needsSearch": true/false,
  "searchQuery": "optimized search query" or null,
  "queryType": "portfolio" or "market_research" or "general_finance"
}

needsSearch = true if question needs current data:
- IPO news, recent valuations, current events
- Company news from last 6 months
- Recent earnings, analyst ratings
- Anything time-sensitive

needsSearch = false if:
- Portfolio analysis (data provided in context)
- General investing concepts
- Historical analysis

Question: "${userMessage}"`
        }],
        response_format: { type: 'json_object' }
      })
    })
    const data = await res.json()
    return JSON.parse(data.choices[0].message.content)
  } catch (e) {
    // Default to no search on error
    return { needsSearch: false, searchQuery: null, queryType: 'general_finance' }
  }
}

// ─── Stage 1: SearXNG Web Search ───
async function searchWeb(query: string): Promise<string> {
  try {
    const res = await fetch(
      `${SEARXNG_URL}/search?q=${encodeURIComponent(query)}&format=json&categories=general,news&language=en`
    )
    const data = await res.json()

    // Take top 3 results
    const results = (data.results || []).slice(0, 3)
    if (results.length === 0) return ''

    return `
CURRENT WEB SEARCH RESULTS for "${query}":
${results.map((r: any, i: number) => `
[${i + 1}] ${r.title}
${r.content || r.snippet || ''}
Source: ${r.url}
`).join('\n')}
Use these results to answer with current information.
Note: search results are from today.
`
  } catch (e) {
    console.error('Search error:', e)
    return ''
  }
}

// ─── POST Handler ───
export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { messages, portfolioContext, mode, timezone } = body

    // ── Usage limit check ──
    const userId = await getOptionalUserId();
    if (userId && userId !== 'anonymous') {
      const { allowed, remaining } = await checkUsageLimit(userId, 'message');
      if (!allowed) {
        return Response.json(
          { error: 'Daily limit reached', remaining: 0 },
          { status: 429 }
        );
      }
    }

    // Build user profile context from request
    const profile: UserProfile = {
      investorStyle: body.investorStyle || 'Lynch',
      riskTolerance: body.riskTolerance || 'Moderate',
      name: body.name || 'M',
      timezone: timezone || 'America/New_York',
    }
    const profileContext = buildUserProfileContext(profile)

    // Finance guard — check last user message
    const lastMessage: string = messages[messages.length - 1]?.content || ''
    const nonFinancePatterns = [
      /^(tell me a joke|write me a poem|what's the weather|recipe for|how to cook|sports score|movie recommendation)/i
    ]
    if (nonFinancePatterns.some(p => p.test(lastMessage))) {
      return Response.json({
        content: "I specialize exclusively in portfolio analysis and market intelligence. What would you like to know about your portfolio or the markets?"
      })
    }

    const systemPrompt = mode === 'alerts'
      ? ALERTS_SYSTEM_PROMPT
      : VANTAGE_SYSTEM_PROMPT

    // Stage 1: DeepSeek screening
    const screening = await screenMessage(lastMessage)

    // Stage 2: Search if needed
    let searchContext = ''
    if (screening.needsSearch && screening.searchQuery) {
      searchContext = await searchWeb(screening.searchQuery)
    }

    // ── Prompt Caching: static instructions cached, dynamic context not ──
    const systemBlocks: SystemBlock[] = [
      {
        type: 'text' as const,
        text: systemPrompt,
        cache_control: { type: 'ephemeral' as const },
      },
      {
        type: 'text' as const,
        text: [profileContext, portfolioContext || '', searchContext].filter(Boolean).join('\n\n'),
      },
    ];

    // Use Haiku for chat, Sonnet for deep analysis
    const model = mode === 'deep'
      ? 'claude-sonnet-4-6'
      : 'claude-haiku-4-5'

    const stream = await client.messages.stream({
      model,
      max_tokens: 1024,
      system: systemBlocks as any,
      messages: messages.map((m: any) => ({
        role: m.role === 'user' ? 'user' : 'assistant',
        content: m.content
      }))
    })

    // ── Increment usage (non-blocking, after check passes) ──
    if (userId && userId !== 'anonymous') {
      incrementUsage(userId, 'message').catch(() => {});
    }

    // Return streaming response
    const encoder = new TextEncoder()
    const readable = new ReadableStream({
      async start(controller) {
        for await (const chunk of stream) {
          if (
            chunk.type === 'content_block_delta' &&
            chunk.delta.type === 'text_delta'
          ) {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ text: chunk.delta.text })}\n\n`)
            )
          }
        }
        controller.enqueue(encoder.encode('data: [DONE]\n\n'))
        controller.close()
      }
    })

    return new Response(readable, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
      }
    })

  } catch (error) {
    console.error('Chat API error:', error)
    return Response.json({ error: 'Failed to process request' }, { status: 500 })
  }
}
