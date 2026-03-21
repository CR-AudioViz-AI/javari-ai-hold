// app/api/javari/forge/route.ts
// Javari Forge — code generation endpoint.
// Dynamic credit cost: base(3) × MODEL_COST_MULTIPLIER[tier].
// forge uses maxTier:moderate → standard(×2) → 6 credits typical.
// If router escalates to expensive, reasoning(×3) → 9 credits.
// Updated: March 21, 2026 — Dynamic cost model.
import { NextRequest, NextResponse } from 'next/server'
import { route } from '@/lib/javari/model-router'
import { checkGate, trackUsage } from '@/lib/billing/gate'
import {
  getCreditBalance,
  deductCredits,
  computeCreditCost,
  tierToModelCostType,
  CREDIT_COSTS,
  MODEL_COST_MULTIPLIER,
} from '@/lib/billing/credits'

export const dynamic = 'force-dynamic'

const SYSTEM_FORGE = [
  'You are Javari Forge — an expert code generator.',
  'Mission: "Your Story. Our Design." by CR AudioViz AI.',
  'Produce complete, production-ready code with no placeholders.',
  'Follow TypeScript strict mode, WCAG 2.2 AA, and OWASP Top 10 by default.',
  'Return code first, then a brief explanation below a --- separator.',
  'Never truncate. Never use // TODO or // add logic here.',
].join('\n')

const BASE_COST       = CREDIT_COSTS.javari_forge        // 3
// Forge is capped at moderate — worst case is standard(×2) = 6 credits
const MAX_POSSIBLE_COST = BASE_COST * MODEL_COST_MULTIPLIER.standard  // 6

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { prompt, language = 'typescript', context, userId } = body as {
      prompt:    string
      language?: string
      context?:  string
      userId?:   string
    }

    if (!prompt?.trim()) {
      return NextResponse.json({ error: 'prompt required' }, { status: 400 })
    }

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
        }, { status: 402 })
      }

      // ── Pre-execution credit check — worst-case cost ────────────────────
      const balance = await getCreditBalance(userId)
      if (balance < MAX_POSSIBLE_COST) {
        return NextResponse.json({
          error:        'no_credits',
          message:      `Code generation requires up to ${MAX_POSSIBLE_COST} credits. You have ${balance}. Please upgrade.`,
          required:     MAX_POSSIBLE_COST,
          available:    balance,
          upgrade_url:  '/pricing',
        }, { status: 402 })
      }
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

    // ── Dynamic cost: actual tier returned by router ────────────────────────
    let creditsCharged = 0
    if (userId) {
      const modelType  = tierToModelCostType(result.tier)
      creditsCharged   = computeCreditCost('javari_forge', modelType)
      // computeCreditCost logs COST_CALC

      trackUsage(userId, 'javari_forge').catch(() => {})
      deductCredits(userId, creditsCharged, 'javari_forge').catch(() => {})
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
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function GET() {
  return NextResponse.json({
    service:       'Javari Forge',
    version:       '1.2',
    endpoint:      'POST /api/javari/forge',
    params:        ['prompt (required)', 'language (default: typescript)', 'context', 'userId'],
    pricing:       {
      base_cost:        CREDIT_COSTS.javari_forge,
      multiplier_low:   MODEL_COST_MULTIPLIER.cheap,
      multiplier_mod:   MODEL_COST_MULTIPLIER.standard,
      typical_cost:     CREDIT_COSTS.javari_forge * MODEL_COST_MULTIPLIER.standard,
      max_cost:         CREDIT_COSTS.javari_forge * MODEL_COST_MULTIPLIER.standard,
    },
    limits: { free: '5/day', pro: '100/day', premium: '500/day' },
  })
}
