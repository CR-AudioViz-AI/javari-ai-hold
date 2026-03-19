// app/api/javari/chat/route.ts
// Javari Chat API — customer-facing AI assistant
// First-turn: neutral open greeting, no assumed context.
// Subsequent turns: adapt to user intent.
// Billing gate: free tier = 10 requests/day.
// Tuesday, March 17, 2026 | Updated: Thursday, March 19, 2026
import { NextRequest, NextResponse } from 'next/server'
import { route }          from '@/lib/javari/model-router'
import { detectTaskType } from '@/lib/javari/router'
import { checkGate, trackUsage } from '@/lib/billing/gate'

export const dynamic = 'force-dynamic'

// First interaction — neutral, no context assumed, no product mentions
const SYSTEM_FIRST = [
  'You are Javari AI, a helpful AI assistant.',
  'This is the opening message of a new session.',
  'Respond with a warm, brief, open-ended greeting only.',
  'Do NOT mention any product, platform, ecosystem, roadmap, or technology.',
  'Do NOT assume what the user needs.',
  'Simply welcome them and ask how you can help.',
  'One or two short sentences maximum.',
].join('\n')

// Subsequent turns — adapt to what the user has actually asked about
const SYSTEM_CONTEXTUAL = [
  'You are Javari AI — helpful, direct, and capable.',
  'Your mission: "Your Story. Our Design."',
  'Adapt your response to what the user actually needs.',
  'Do not assume internal context unless the user has explicitly provided it.',
].join('\n')

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { message, history, userId } = body as {
      message:  string
      history?: Array<{ role: string; content: string }>
      userId?:  string
    }

    if (!message?.trim()) {
      return NextResponse.json({ error: 'message required' }, { status: 400 })
    }

    // First turn detection: no prior user messages in history
    const priorUserMessages = (history ?? []).filter(m => m.role === 'user')
    const isFirstTurn       = priorUserMessages.length === 0

    // ── Billing gate (skip on first turn — greetings are always free) ─────────
    if (!isFirstTurn && userId) {
      const gate = await checkGate(userId, 'javari_chat')
      if (!gate.allowed) {
        return NextResponse.json({
          error:       gate.error,
          message:     gate.message,
          upgrade_url: gate.upgrade_url,
          tier:        gate.tier,
          used:        gate.used,
          limit:       gate.limit,
        }, { status: 402 })
      }
    }
    // ── End billing gate ──────────────────────────────────────────────────────

    const systemPrompt = isFirstTurn ? SYSTEM_FIRST : SYSTEM_CONTEXTUAL
    const taskType     = isFirstTurn ? 'chat' : (detectTaskType(message) as any)

    const result = await route(taskType, message, { systemPrompt })

    if (result.blocked) {
      return NextResponse.json({ error: result.reason, blocked: true }, { status: 429 })
    }

    // Track usage after successful execution (fire-and-forget)
    if (!isFirstTurn) {
      trackUsage(userId, 'javari_chat').catch(() => {})
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
