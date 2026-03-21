// app/api/javari/forge/route.ts
// Javari Forge — code generation endpoint.
// Dynamic credit cost: base(3) × MODEL_COST_MULTIPLIER[tier].
// Ceiling: standard (×2) = 6 credits max.
// Safety lock: enforcePrecheck() before execution. Idempotency key on deduction.
// Upsell: computes and returns upsell payload when balance low or request blocked.
// Updated: March 21, 2026 — Credit pack upsell system.
import { NextRequest, NextResponse } from 'next/server'
import { route } from '@/lib/javari/model-router'
import { checkGate, trackUsage } from '@/lib/billing/gate'
import {
  enforcePrecheck,
  deductCredits,
  computeCreditCost,
  tierToModelCostType,
  CREDIT_COSTS,
  MODEL_COST_MULTIPLIER,
} from '@/lib/billing/credits'
import { computeUpsell, type UpsellResult } from '@/lib/billing/upsell'

export const dynamic = 'force-dynamic'

const SYSTEM_FORGE = [
  'You are Javari Forge — an expert code generator.',
  'Mission: "Your Story. Our Design." by CR AudioViz AI.',
  'Produce complete, production-ready code with no placeholders.',
  'Follow TypeScript strict mode, WCAG 2.2 AA, and OWASP Top 10 by default.',
  'Return code first, then a brief explanation below a --- separator.',
  'Never truncate. Never use // TODO or // add logic here.',
].join('\n')

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { prompt, language = 'typescript', context, userId, userTier = 'free' } = body as {
      prompt:    string
      language?: string
      context?:  string
      userId?:   string
      userTier?: string
    }

    if (!prompt?.trim()) {
      return NextResponse.json({ error: 'prompt required' }, { status: 400 })
    }

    let precheckRequestId: string | undefined
    let precheckBalance:   number = Infinity

    if (userId) {
      // ── Daily rate gate ─────────────────────────────────────────────────
      const gate = await checkGate(userId, 'javari_forge')
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
      const precheck = await enforcePrecheck(userId, 'javari_forge')
      precheckBalance = precheck.balance

      if (!precheck.allowed) {
        return NextResponse.json({
          error:       'no_credits',
          message:     `Code generation requires up to ${precheck.required} credits. You have ${precheck.balance}. Please upgrade.`,
          required:    precheck.required,
          available:   precheck.balance,
          reason:      precheck.reason,
          upgrade_url: '/pricing',
          upsell:      computeUpsell(precheck.balance, userTier, true),
        }, { status: 402 })
      }
      precheckRequestId = precheck.requestId
    }

    const fullPrompt = [
      `Language: ${language}`,
      context ? `Context:\n${context}` : '',
      `Task:\n${prompt}`,
    ].filter(Boolean).join('\n\n')

    const result = await route('coding', fullPrompt, {
      systemPrompt: SYSTEM_FORGE,
      maxTier:      'moderate',
    })

    if (result.blocked) {
      return NextResponse.json({ error: result.reason, blocked: true }, { status: 429 })
    }

    const parts       = result.content.split(/^---$/m)
    const code        = parts[0]?.trim() ?? result.content
    const explanation = parts[1]?.trim() ?? ''

    let creditsCharged = 0
    let upsell: UpsellResult = { show: false }

    if (userId) {
      const modelType  = tierToModelCostType(result.tier)
      creditsCharged   = computeCreditCost('javari_forge', modelType)
      trackUsage(userId, 'javari_forge').catch(() => {})
      deductCredits(userId, creditsCharged, 'javari_forge', precheckRequestId).catch(() => {})

      if (precheckBalance !== Infinity) {
        const balanceAfter = Math.max(0, precheckBalance - creditsCharged)
        upsell = computeUpsell(balanceAfter, userTier, false)
      }
    }

    return NextResponse.json({
      code,
      explanation,
      language,
      model:        result.model,
      provider:     result.provider,
      tier:         result.tier,
      cost:         result.cost,
      credits_used: creditsCharged,
      upsell,
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function GET() {
  return NextResponse.json({
    service:  'Javari Forge',
    version:  '1.4',
    endpoint: 'POST /api/javari/forge',
    params:   ['prompt (required)', 'language', 'context', 'userId', 'userTier'],
    pricing: {
      base_cost:   CREDIT_COSTS.javari_forge,
      ceiling:     `standard (×${MODEL_COST_MULTIPLIER.standard})`,
      max_credits: CREDIT_COSTS.javari_forge * MODEL_COST_MULTIPLIER.standard,
    },
    limits: { free: '5/day', pro: '100/day', premium: '500/day' },
  })
}
