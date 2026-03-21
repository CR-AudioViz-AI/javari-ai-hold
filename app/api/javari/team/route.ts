// app/api/javari/team/route.ts
// Javari Team API — multi-model ensemble (planner → builder → validator).
// Fixed cost: base(5) × multi_agent(×5) = 25 credits. No dynamic adjustment.
// Ceiling = actual cost for team — pre-check and post-deduction use same value.
// Safety lock: enforcePrecheck() before first model call. Idempotency key on deduction.
// Retry protection: each POST is one attempt. No internal retry loop here.
// Updated: March 21, 2026 — Final safety lock.
import { NextRequest, NextResponse } from 'next/server'
import { route } from '@/lib/javari/model-router'
import { checkGate, trackUsage } from '@/lib/billing/gate'
import {
  enforcePrecheck,
  deductCredits,
  computeCreditCost,
} from '@/lib/billing/credits'

export const dynamic = 'force-dynamic'

const SYSTEM_FIRST = [
  'You are Javari AI, a helpful AI assistant.',
  'This is the opening message of a new session.',
  'Respond with a warm, brief, open-ended greeting only.',
  'Do NOT mention any product, platform, ecosystem, or technology.',
  'Simply welcome them and ask how you can help.',
  'One or two short sentences maximum.',
].join('\n')

const SYSTEM = [
  'You are part of Javari AI — "Your Story. Our Design."',
  'Be precise, direct, and adapt to what the user actually needs.',
].join('\n')

// Team cost is fixed — always multi_agent, always 25 credits.
// computeCreditCost logs COST_CALC at module load.
const ROUTE_COST = computeCreditCost('javari_team', 'multi_agent')  // 25

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

    // First turn: free greeting — no gate, no billing, no precheck
    if (isFirstTurn) {
      const result = await route('chat', message, { systemPrompt: SYSTEM_FIRST })
      return NextResponse.json({
        content:      result.content,
        model:        result.model,
        tier:         result.tier,
        ensemble:     [],
        total_cost:   result.cost,
        credits_used: 0,
      })
    }

    let precheckRequestId: string | undefined

    if (userId) {
      // ── Daily rate gate ─────────────────────────────────────────────────
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

      // ── enforcePrecheck — ceiling: multi_agent (fixed = 25 credits) ──────
      // For team, ceiling IS the cost. There is no post-execution adjustment.
      // Emits PRECHECK log. Enforces both guards (< required, result < 0).
      const precheck = await enforcePrecheck(userId, 'javari_team', 'multi_agent')
      if (!precheck.allowed) {
        return NextResponse.json({
          error:       'no_credits',
          message:     `Team ensemble costs ${precheck.required} credits (3 AI calls × multi-agent multiplier). You have ${precheck.balance}. Please upgrade.`,
          required:    precheck.required,
          available:   precheck.balance,
          reason:      precheck.reason,
          upgrade_url: '/pricing',
        }, { status: 402 })
      }
      precheckRequestId = precheck.requestId
    }

    // ── Execute all 3 ensemble steps ────────────────────────────────────────
    // No internal retry loop — each POST to this route is exactly one attempt.
    // The route() function handles provider failover internally (not billable).
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

    // ── Post-success: single deduction of ROUTE_COST (25), idempotency-keyed ─
    if (userId) {
      trackUsage(userId, 'javari_team').catch(() => {})
      deductCredits(userId, ROUTE_COST, 'javari_team', precheckRequestId).catch(() => {})
    }

    return NextResponse.json({
      content:      validate.content,
      model:        validate.model,
      tier:         validate.tier,
      total_cost:   steps.reduce((s, step) => s + step.cost, 0),
      ensemble:     steps,
      credits_used: ROUTE_COST,
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
