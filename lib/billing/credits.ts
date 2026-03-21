// lib/billing/credits.ts
// Credit consumption helpers — check balance and deduct on successful use.
// Calls craudiovizai.com as central billing authority.
// Updated: March 21, 2026 — Dynamic cost model (MODEL_COST_MULTIPLIER).
//
// COST ARCHITECTURE
// -----------------
// base_cost × model_multiplier = credits_charged
//
// BASE COSTS (flat per route — what the route costs at minimum):
//   javari_chat  : 1 credit
//   javari_forge : 3 credits
//   javari_team  : 5 credits  (3-call ensemble — multiplier applied to whole unit)
//   javari_worker: 0 credits  (internal — exempt)
//
// MODEL_COST_MULTIPLIER (scales base cost by actual model complexity):
//   cheap       : ×1   (gpt-4o-mini, haiku — tier: free/low)
//   standard    : ×2   (sonnet, gpt-4o — tier: moderate)
//   reasoning   : ×3   (o1, claude-opus — tier: expensive)
//   multi_agent : ×5   (ensemble routes with 3+ AI calls — route-level override)
//   image       : ×10  (DALL-E, Flux, SDXL — non-text generation)
//
// EXAMPLE:
//   forge (base=3) + standard model (×2) = 6 credits
//   team  (base=5) + multi_agent  (×5) = 25 credits  [always multi_agent]
//   chat  (base=1) + cheap model  (×1) = 1 credit
//   chat  (base=1) + standard     (×2) = 2 credits  [if router escalates]

const BILLING_BASE = process.env.BILLING_SERVICE_URL ?? 'https://craudiovizai.com'

// ── Base cost constants ───────────────────────────────────────────────────────
export const CREDIT_COSTS = {
  javari_chat:   1,
  javari_forge:  3,
  javari_team:   5,
  javari_worker: 0,
} as const

export type CreditSource = keyof typeof CREDIT_COSTS

// ── Model type → credit multiplier ───────────────────────────────────────────
// These multiply the base route cost to reflect real model expense.
export const MODEL_COST_MULTIPLIER = {
  cheap:       1,   // gpt-4o-mini, haiku — low tier
  standard:    2,   // sonnet, gpt-4o — moderate tier
  reasoning:   3,   // o1, claude-opus — expensive tier
  multi_agent: 5,   // ensemble routes (3+ sequential AI calls)
  image:       10,  // DALL-E, Flux, SDXL — image generation
} as const

export type ModelCostType = keyof typeof MODEL_COST_MULTIPLIER

// ── Tier → ModelCostType mapping ─────────────────────────────────────────────
// Maps the ModelTier returned by route() to our billing cost type.
export function tierToModelCostType(tier: string): ModelCostType {
  switch (tier) {
    case 'free':
    case 'low':      return 'cheap'
    case 'moderate': return 'standard'
    case 'expensive': return 'reasoning'
    default:         return 'cheap'  // fail safe — never overcharge on unknown
  }
}

// ── Core cost calculation ─────────────────────────────────────────────────────
/**
 * Compute the final credit cost for a route + model tier combination.
 *
 * @param source     - route identifier (from CREDIT_COSTS)
 * @param modelType  - model complexity type (from MODEL_COST_MULTIPLIER)
 * @returns          - integer credits to charge (always >= 0)
 *
 * @example
 *   computeCreditCost('javari_forge', 'standard')  // 3 × 2 = 6
 *   computeCreditCost('javari_team',  'multi_agent') // 5 × 5 = 25
 *   computeCreditCost('javari_chat',  'cheap')      // 1 × 1 = 1
 */
export function computeCreditCost(source: CreditSource, modelType: ModelCostType): number {
  const base       = CREDIT_COSTS[source]
  const multiplier = MODEL_COST_MULTIPLIER[modelType]
  const total      = base * multiplier

  console.log('COST_CALC', {
    route:      source,
    base,
    multiplier,
    total,
    model_type: modelType,
    timestamp:  new Date().toISOString(),
  })

  return total
}

// ── Balance check ─────────────────────────────────────────────────────────────
/**
 * Check current credit balance for a user.
 * Returns Infinity if userId is absent (graceful degradation — never block unauthed).
 */
export async function getCreditBalance(
  userId: string | null | undefined,
): Promise<number> {
  if (!userId) return Infinity

  try {
    const res = await fetch(
      `${BILLING_BASE}/api/billing/usage?userId=${encodeURIComponent(userId)}&feature=credits`,
      { method: 'GET', signal: AbortSignal.timeout(3000) }
    )
    if (!res.ok) return Infinity

    const data = await res.json() as { month?: Record<string, number> }
    return Math.max(0, data.month?.credits ?? 0)
  } catch {
    return Infinity  // network error — fail open, never block
  }
}

/**
 * Check whether a user can afford a given credit cost.
 * Always returns true when userId is absent.
 */
export async function hasSufficientCredits(
  userId: string | null | undefined,
  required: number,
): Promise<boolean> {
  if (!userId) return true
  const balance = await getCreditBalance(userId)
  return balance >= required
}

// ── Deduction ─────────────────────────────────────────────────────────────────
/**
 * Deduct credits after successful feature execution.
 * Fire-and-forget — never throws. Call ONLY after confirmed success.
 *
 * @param userId  - user performing the action (no-op if falsy or cost=0)
 * @param cost    - exact cost from computeCreditCost() — never a magic number
 * @param source  - named route for audit trail
 */
export async function deductCredits(
  userId: string | null | undefined,
  cost: number,
  source: CreditSource,
): Promise<void> {
  if (!userId) return
  if (cost <= 0) return  // Zero-cost paths (worker, first-turn) are no-ops

  console.log('CREDITS_USED', {
    route:     source,
    cost,
    userId:    userId.slice(0, 8) + '…',  // partial ID — never full PII
    timestamp: new Date().toISOString(),
  })

  try {
    await fetch(`${BILLING_BASE}/api/billing/usage`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        userId,
        feature:  'credits',
        count:    -cost,
        metadata: { type: 'usage', source, cost },
      }),
      signal: AbortSignal.timeout(3000),
    })
  } catch (err) {
    console.error('[billing/credits] deductCredits failed:', { source, cost, err })
  }
}
