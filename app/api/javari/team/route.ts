// app/api/javari/team/route.ts
// Javari Team API — multi-model ensemble (planner -> builder -> validator)
// First-turn: neutral greeting only. Subsequent turns: full ensemble.
// Billing gate: free tier = 3 council requests/day.
// Tuesday, March 17, 2026 | Updated: Thursday, March 19, 2026
import { NextRequest, NextResponse } from 'next/server'
import { route } from '@/lib/javari/model-router'
import { checkGate, trackUsage } from '@/lib/billing/gate'

export const dynamic = 'force-dynamic'

// Opening message — neutral, no assumptions
const SYSTEM_FIRST = [
  'You are Javari AI, a helpful AI assistant.',
  'This is the opening message of a new session.',
  'Respond with a warm, brief, open-ended greeting only.',
  'Do NOT mention any product, platform, ecosystem, or technology.',
  'Simply welcome them and ask how you can help.',
  'One or two short sentences maximum.',
].join('\n')

// Council members — adapt to what user needs
const SYSTEM = [
  'You are part of Javari AI — "Your Story. Our Design."',
  'Be precise, direct, and adapt to what the user actually needs.',
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

    // First turn: skip gate + ensemble, return simple greeting
    const priorUserMessages = (history ?? []).filter(m => m.role === 'user')
    const isFirstTurn       = priorUserMessages.length === 0

    if (isFirstTurn) {
      const result = await route('chat', message, { systemPrompt: SYSTEM_FIRST })
      return NextResponse.json({
        content:    result.content,
        model:      result.model,
        tier:       result.tier,
        ensemble:   [],
        total_cost: result.cost,
      })
    }

    // ── Billing gate ──────────────────────────────────────────────────────────
    if (userId) {
      const gate = await checkGate(userId, 'javari_team')
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

    // Subsequent turns: full three-step ensemble
    const steps: { role: string; model: string; tier: string; content: string; cost: number }[] = []

    const plan = await route('planning',
      'Break down this task into 3-5 concrete steps. Be brief.\n\nTask: ' + message,
      { systemPrompt: SYSTEM }
    )
    steps.push({ role: 'planner', model: plan.model, tier: plan.tier, content: plan.content, cost: plan.cost })

    const build = await route('coding',
      'Plan:\n' + plan.content + '\n\nNow execute this plan fully for: ' + message,
      { systemPrompt: SYSTEM }
    )
    steps.push({ role: 'builder', model: build.model, tier: build.tier, content: build.content, cost: build.cost })

    const validate = await route('verification',
      'Review this output and return the final best version only.\n\nOutput:\n' + build.content,
      { systemPrompt: SYSTEM }
    )
    steps.push({ role: 'validator', model: validate.model, tier: validate.tier, content: validate.content, cost: validate.cost })

    // Track usage after successful execution (fire-and-forget)
    trackUsage(userId, 'javari_team').catch(() => {})

    return NextResponse.json({
      content:    validate.content,
      model:      validate.model,
      tier:       validate.tier,
      total_cost: steps.reduce((s, step) => s + step.cost, 0),
      ensemble:   steps,
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
