// app/api/javari/chat/route.ts
// Javari Chat API — customer-facing AI assistant.
// Dynamic credit cost: base(1) × MODEL_COST_MULTIPLIER[tier].
// Ceiling: standard (×2) = 2 credits max. Actual charge from result.tier.
// Safety lock: enforcePrecheck() before every execution. Idempotency key on deduction.
// Updated: March 21, 2026 — Final safety lock.
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

    let precheckRequestId: string | undefined

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
        }, { status: 402 })
      }

      // ── enforcePrecheck — ceiling: standard (worst case = 2 credits) ────
      // Emits PRECHECK log. Checks balance >= required AND balance - required >= 0.
      // Returns requestId used as idempotency key for deductCredits.
      const precheck = await enforcePrecheck(userId, 'javari_chat')
      if (!precheck.allowed) {
        return NextResponse.json({
          error:       'no_credits',
          message:     `Chat requires up to ${precheck.required} credits. You have ${precheck.balance}. Please upgrade.`,
          required:    precheck.required,
          available:   precheck.balance,
          reason:      precheck.reason,
          upgrade_url: '/pricing',
        }, { status: 402 })
      }
      precheckRequestId = precheck.requestId
    }

    const systemPrompt = isFirstTurn ? SYSTEM_FIRST : SYSTEM_CONTEXTUAL
    const taskType     = isFirstTurn ? 'chat' : (detectTaskType(message) as any)

    // ── Execute AI ──────────────────────────────────────────────────────────
    const result = await route(taskType, message, { systemPrompt })

    if (result.blocked) {
      return NextResponse.json({ error: result.reason, blocked: true }, { status: 429 })
    }

    // ── Post-success: compute actual cost from real tier, deduct once ──────
    let creditsCharged = 0
    if (!isFirstTurn) {
      const modelType  = tierToModelCostType(result.tier)
      creditsCharged   = computeCreditCost('javari_chat', modelType)
      // COST_CALC logged inside computeCreditCost

      trackUsage(userId, 'javari_chat').catch(() => {})
      // Pass requestId — billing authority deduplicates on this key
      deductCredits(userId, creditsCharged, 'javari_chat', precheckRequestId).catch(() => {})
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
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
