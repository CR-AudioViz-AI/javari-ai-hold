// app/api/javari/chat/route.ts
// Javari Chat API — customer-facing AI assistant
// First-turn: neutral open greeting, no assumed context.
// Subsequent turns: adapt to user intent.
// Billing gate: free tier = 10 requests/day.
// Credit check: deduct 1 credit per successful non-first-turn request.
// Tuesday, March 17, 2026 | Updated: Thursday, March 19, 2026
import { NextRequest, NextResponse } from 'next/server'
import { route }          from '@/lib/javari/model-router'
import { detectTaskType } from '@/lib/javari/router'
import { checkGate, trackUsage } from '@/lib/billing/gate'
import { getCreditBalance, deductCredit } from '@/lib/billing/credits'

export const dynamic = 'force-dynamic'

const SYSTEM_FIRST = [
  'You are Javari AI, a helpful AI assistant.',
  'This is the opening message of a new session.',
  'Respond with a warm, brief, open-ended greeting only.',
  'Do NOT mention any product, platform, ecosystem, roadmap, or technology.',
  'Do NOT assume what the user needs.',
  'Simply welcome them and ask how you can help.',
  'One or two short sentences maximum.',
].join('\n')

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

    const priorUserMessages = (history ?? []).filter(m => m.role === 'user')
    const isFirstTurn       = priorUserMessages.length === 0

    // First turn is always free — greetings never gate or consume credits
    if (!isFirstTurn && userId) {

      // ── Daily rate gate ───────────────────────────────────────────────────
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

      // ── Credit balance check ──────────────────────────────────────────────
      const balance = await getCreditBalance(userId)
      if (balance <= 0) {
        return NextResponse.json({
          error:       'no_credits',
          message:     'You are out of credits. Please upgrade.',
          upgrade_url: '/pricing',
        }, { status: 402 })
      }
    }

    const systemPrompt = isFirstTurn ? SYSTEM_FIRST : SYSTEM_CONTEXTUAL
    const taskType     = isFirstTurn ? 'chat' : (detectTaskType(message) as any)

    const result = await route(taskType, message, { systemPrompt })

    if (result.blocked) {
      return NextResponse.json({ error: result.reason, blocked: true }, { status: 429 })
    }

    // ── Post-success tracking (fire-and-forget, only on success) ──────────
    if (!isFirstTurn) {
      trackUsage(userId, 'javari_chat').catch(() => {})
      deductCredit(userId, 'javari_chat').catch(() => {})
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
