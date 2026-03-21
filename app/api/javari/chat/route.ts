// app/api/javari/chat/route.ts
// Javari Chat API — customer-facing AI assistant.
// Dynamic credit cost: base(1) × MODEL_COST_MULTIPLIER[tier].
// Ceiling: standard (×2) = 2 credits max. Actual charge from result.tier.
// Safety lock: enforcePrecheck() before every execution. Idempotency key on deduction.
// Upsell: computes and returns upsell payload when balance low or request blocked.
// Updated: March 21, 2026 — Credit pack upsell system.
import { NextRequest, NextResponse } from 'next/server'
import { route }          from '@/lib/javari/model-router'
import { detectTaskType } from '@/lib/javari/router'
import { checkGate, trackUsage } from '@/lib/billing/gate'
import {
  enforcePrecheck,
  deductCredits,
  computeCreditCost,
  tierToModelCostType,
} from '@/lib/billing/credits'
import { computeUpsell, type UpsellResult } from '@/lib/billing/upsell'

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
    const { message, history, userId, userTier = 'free' } = body as {
      message:   string
      history?:  Array<{ role: string; content: string }>
      userId?:   string
      userTier?: string   // caller passes tier from their auth context
    }

    if (!message?.trim()) {
      return NextResponse.json({ error: 'message required' }, { status: 400 })
    }

    const priorUserMessages = (history ?? []).filter(m => m.role === 'user')
    const isFirstTurn       = priorUserMessages.length === 0
    let precheckRequestId:  string | undefined
    let precheckBalance:    number = Infinity

    // First turn always free — greetings skip all gates and billing
    if (!isFirstTurn && userId) {

      // ── Daily rate gate ─────────────────────────────────────────────────
      const gate = await checkGate(userId, 'javari_chat')
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

      // ── enforcePrecheck ─────────────────────────────────────────────────
      const precheck = await enforcePrecheck(userId, 'javari_chat')
      precheckBalance = precheck.balance  // capture for post-success upsell

      if (!precheck.allowed) {
        return NextResponse.json({
          error:       'no_credits',
          message:     `Chat requires up to ${precheck.required} credits. You have ${precheck.balance}. Please upgrade.`,
          required:    precheck.required,
          available:   precheck.balance,
          reason:      precheck.reason,
          upgrade_url: '/pricing',
          upsell:      computeUpsell(precheck.balance, userTier, true),
        }, { status: 402 })
      }
      precheckRequestId = precheck.requestId
    }

    const systemPrompt = isFirstTurn ? SYSTEM_FIRST : SYSTEM_CONTEXTUAL
    const taskType     = isFirstTurn ? 'chat' : (detectTaskType(message) as any)

    const result = await route(taskType, message, { systemPrompt })

    if (result.blocked) {
      return NextResponse.json({ error: result.reason, blocked: true }, { status: 429 })
    }

    let creditsCharged = 0
    let upsell: UpsellResult = { show: false }

    if (!isFirstTurn) {
      const modelType  = tierToModelCostType(result.tier)
      creditsCharged   = computeCreditCost('javari_chat', modelType)
      trackUsage(userId, 'javari_chat').catch(() => {})
      deductCredits(userId, creditsCharged, 'javari_chat', precheckRequestId).catch(() => {})

      // ── Post-success upsell: balance after deduction ──────────────────
      // precheckBalance was confirmed just before execution.
      // Subtract creditsCharged for accurate post-deduction estimate.
      if (userId && precheckBalance !== Infinity) {
        const balanceAfter = Math.max(0, precheckBalance - creditsCharged)
        upsell = computeUpsell(balanceAfter, userTier, false)
      }
    }

    return NextResponse.json({
      content:      result.content,
      model:        result.model,
      provider:     result.provider,
      tier:         result.tier,
      taskType:     result.taskType,
      cost:         result.cost,
      attempts:     result.attempts,
      credits_used: creditsCharged,
      upsell,
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
