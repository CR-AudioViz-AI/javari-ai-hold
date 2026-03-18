// app/api/javari/chat/route.ts
// Javari Chat API — customer-facing AI assistant
// First-turn: neutral open greeting, no assumed context.
// Subsequent turns: adapt to user intent.
// Tuesday, March 17, 2026
import { NextRequest, NextResponse } from 'next/server'
import { route }          from '@/lib/javari/model-router'
import { detectTaskType } from '@/lib/javari/router'

export const dynamic = 'force-dynamic'

// System prompt for first interaction — no ecosystem context, no assumed scope
const SYSTEM_FIRST = [
  'You are Javari AI, a helpful AI assistant.',
  'This is the user's first message. Respond with a warm, brief, open-ended greeting only.',
  'Do NOT mention any specific product, platform, ecosystem, roadmap, or technology.',
  'Do NOT assume what the user needs.',
  'Simply welcome them and ask how you can help.',
  'Keep the greeting to one or two short sentences maximum.',
].join('\n')

// System prompt for subsequent turns — adapt to the conversation
const SYSTEM_CONTEXTUAL = [
  'You are Javari AI — "Your Story. Our Design."',
  'You are a capable AI assistant. Be direct, helpful, and adapt to what the user actually needs.',
  'Do not assume internal context unless the user has explicitly provided it.',
].join('\n')

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { message, history } = body as {
      message: string
      history?: Array<{ role: string; content: string }>
    }

    if (!message?.trim()) {
      return NextResponse.json({ error: 'message required' }, { status: 400 })
    }

    // First turn = no prior user messages in history
    const priorUserMessages = (history ?? []).filter(m => m.role === 'user')
    const isFirstTurn = priorUserMessages.length === 0

    const systemPrompt = isFirstTurn ? SYSTEM_FIRST : SYSTEM_CONTEXTUAL
    const taskType     = isFirstTurn ? 'chat' : detectTaskType(message) as any

    const result = await route(taskType, message, { systemPrompt })

    if (result.blocked) {
      return NextResponse.json({ error: result.reason, blocked: true }, { status: 429 })
    }

    return NextResponse.json({
      content:  result.content,
      model:    result.model,
      provider: result.provider,
      tier:     result.tier,
      taskType: result.taskType,
      cost:     result.cost,
      attempts: result.attempts,
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
