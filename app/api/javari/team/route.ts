// app/api/javari/team/route.ts
// Javari Team API — multi-model ensemble (planner → builder → validator).
// Fixed cost: base(5) × multi_agent(×5) = 25 credits.
// Safety lock: enforcePrecheck() before first model call. Idempotency key on deduction.
// Upsell: computes and returns upsell payload when balance low or request blocked.
// Updated: March 21, 2026 — Credit pack upsell system.
import { NextRequest, NextResponse } from 'next/server'
import { route } from '@/lib/javari/model-router'
import { checkGate, trackUsage } from '@/lib/billing/gate'
import {
  enforcePrecheck,
  deductCredits,
  computeCreditCost,
} from '@/lib/billing/credits'
import { computeUpsell, type UpsellResult } from '@/lib/billing/upsell'

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

const ROUTE_COST = computeCreditCost('javari_team', 'multi_agent')  // 25

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { message, history, userId, userTier = 'free' } = body as {
      message:   string
      history?:  Array<{ role: string; content: string }>
      userId?:   string
      userTier?: string
    }

    if (!message?.trim()) {
      return NextResponse.json({ error: 'message required' }, { status: 400 })
    }

    const priorUserMessages = (history ?? []).filter(m => m.role === 'user')
    const isFirstTurn       = priorUserMessages.length === 0

    if (isFirstTurn) {
      const result = await route('chat', message, { systemPrompt: SYSTEM_FIRST })
      return NextResponse.json({
        content:      result.content,
        model:        result.model,
        tier:         result.tier,
        ensemble:     [],
        total_cost:   result.cost,
        credits_used: 0,
        upsell:       { show: false },
      })
    }

    let precheckRequestId: string | undefined
    let precheckBalance:   number = Infinity

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
          upsell:      computeUpsell(0, userTier, true),
        }, { status: 402 })
      }

      // ── enforcePrecheck — full 25cr upfront ─────────────────────────────
      const precheck = await enforcePrecheck(userId, 'javari_team', 'multi_agent')
      precheckBalance = precheck.balance

      if (!precheck.allowed) {
        return NextResponse.json({
          error:       'no_credits',
          message:     `Team ensemble costs ${precheck.required} credits. You have ${precheck.balance}. Please upgrade.`,
          required:    precheck.required,
          available:   precheck.balance,
          reason:      precheck.reason,
          upgrade_url: '/pricing',
          upsell:      computeUpsell(precheck.balance, userTier, true),
        }, { status: 402 })
      }
      precheckRequestId = precheck.requestId
    }

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

    if (userId) {
      trackUsage(userId, 'javari_team').catch(() => {})
      deductCredits(userId, ROUTE_COST, 'javari_team', precheckRequestId).catch(() => {})
    }

    let upsell: UpsellResult = { show: false }
    if (userId && precheckBalance !== Infinity) {
      const balanceAfter = Math.max(0, precheckBalance - ROUTE_COST)
      upsell = computeUpsell(balanceAfter, userTier, false)
    }

    return NextResponse.json({
      content:      validate.content,
      model:        validate.model,
      tier:         validate.tier,
      total_cost:   steps.reduce((s, step) => s + step.cost, 0),
      ensemble:     steps,
      credits_used: ROUTE_COST,
      upsell,
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
