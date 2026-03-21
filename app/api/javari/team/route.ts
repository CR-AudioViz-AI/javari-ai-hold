// app/api/javari/team/route.ts
// Javari Team API — multi-model ensemble (planner → builder → validator).
// Dynamic credit cost: base(5) × multi_agent(×5) = 25 credits.
// Team is ALWAYS multi_agent — 3 sequential AI calls, no exceptions.
// Pre-check 25 credits before first model call. Deduct once after full success.
// Updated: March 21, 2026 — Dynamic cost model.
import { NextRequest, NextResponse } from 'next/server'
import { route } from '@/lib/javari/model-router'
import { checkGate, trackUsage } from '@/lib/billing/gate'
import {
  getCreditBalance,
  deductCredits,
  computeCreditCost,
  CREDIT_COSTS,
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

// Team ALWAYS uses multi_agent — it runs 3 AI calls regardless of tier.
// Route-level override: model type is fixed, not derived from result.tier.
// base(5) × multi_agent(5) = 25 credits
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

    // First turn: free greeting, skip all gates
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

      // ── Pre-execution credit check — full ensemble cost before first call ─
      const balance = await getCreditBalance(userId)
      if (balance < ROUTE_COST) {
        return NextResponse.json({
          error:        'no_credits',
          message:      `Team ensemble costs ${ROUTE_COST} credits (3 AI calls × multi-agent multiplier). You have ${balance}. Please upgrade.`,
          required:     ROUTE_COST,
          available:    balance,
          upgrade_url:  '/pricing',
        }, { status: 402 })
      }
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

    // ── Single deduction: ROUTE_COST (25) after all 3 steps succeed ───────
    if (userId) {
      trackUsage(userId, 'javari_team').catch(() => {})
      deductCredits(userId, ROUTE_COST, 'javari_team').catch(() => {})
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
