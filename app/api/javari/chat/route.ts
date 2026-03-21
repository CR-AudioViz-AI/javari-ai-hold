// app/api/javari/chat/route.ts
// Javari Chat API — customer-facing AI assistant.
// Dynamic credit cost: base(1) × MODEL_COST_MULTIPLIER[tier].
// First-turn free. Subsequent turns priced by actual model used.
// Updated: March 21, 2026 — Dynamic cost model.
import { NextRequest, NextResponse } from 'next/server'
import { route }          from '@/lib/javari/model-router'
import { detectTaskType } from '@/lib/javari/router'
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

// Base cost — multiplied by actual model tier after route() returns
const BASE_COST = CREDIT_COSTS.javari_chat  // 1

// Pre-execution ceiling check: worst-case cost = base × standard (×2)
// We block if the user can't afford the MAX possible tier for this route.
// If the router uses a cheaper model, the final charge will be lower.
const MAX_POSSIBLE_COST = BASE_COST * MODEL_COST_MULTIPLIER.standard  // 2

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

    // First turn always free — greetings never gate or consume credits
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

      // ── Pre-execution credit check — worst-case cost ──────────────────
      const balance = await getCreditBalance(userId)
      if (balance < MAX_POSSIBLE_COST) {
        return NextResponse.json({
          error:        'no_credits',
          message:      `Chat requires up to ${MAX_POSSIBLE_COST} credits. You have ${balance}. Please upgrade.`,
          required:     MAX_POSSIBLE_COST,
          available:    balance,
          upgrade_url:  '/pricing',
        }, { status: 402 })
      }
    }

    const systemPrompt = isFirstTurn ? SYSTEM_FIRST : SYSTEM_CONTEXTUAL
    const taskType     = isFirstTurn ? 'chat' : (detectTaskType(message) as any)

    const result = await route(taskType, message, { systemPrompt })

    if (result.blocked) {
      return NextResponse.json({ error: result.reason, blocked: true }, { status: 429 })
    }

    // ── Dynamic cost calculation based on actual model tier used ──────────
    // route() returns the real tier (low/moderate/expensive).
    // We compute the cost NOW — after we know what model was actually used.
    let creditsCharged = 0
    if (!isFirstTurn) {
      const modelType    = tierToModelCostType(result.tier)
      creditsCharged     = computeCreditCost('javari_chat', modelType)
      // computeCreditCost already logs COST_CALC

      trackUsage(userId, 'javari_chat').catch(() => {})
      deductCredits(userId, creditsCharged, 'javari_chat').catch(() => {})
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
