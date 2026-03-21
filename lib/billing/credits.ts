// lib/billing/credits.ts
// Credit consumption helpers — check balance and deduct on successful use.
// Calls craudiovizai.com as central billing authority.
// Updated: March 21, 2026 — Controlled fail-open (SAFE_FALLBACK_CREDITS).
//
// COST ARCHITECTURE
// -----------------
// base_cost × model_multiplier = credits_charged
//
// BASE COSTS (minimum per route):
//   javari_chat  : 1 credit
//   javari_forge : 3 credits
//   javari_team  : 5 credits  (3-call ensemble)
//   javari_worker: 0 credits  (internal — exempt)
//
// MODEL_COST_MULTIPLIER:
//   cheap       : ×1   (gpt-4o-mini, haiku — tier: free/low)
//   standard    : ×2   (sonnet, gpt-4o — tier: moderate)
//   reasoning   : ×3   (o1, claude-opus — tier: expensive)
//   multi_agent : ×5   (ensemble routes — 3+ sequential AI calls)
//   image       : ×10  (DALL-E, Flux, SDXL)
//
// ROUTE CEILINGS (pre-execution worst-case checks):
//   chat  → standard    (1 × 2 =  2cr)
//   forge → standard    (3 × 2 =  6cr)
//   team  → multi_agent (5 × 5 = 25cr)  [always fixed]
//
// FAIL-OPEN POLICY (billing service unreachable):
//   Balance reported as SAFE_FALLBACK_CREDITS (10) — NOT Infinity.
//   Routes costing ≤ 10cr: allowed.
//   Routes costing  > 10cr OR type = multi_agent/reasoning: BLOCKED.
//   Error logged: BILLING_UNAVAILABLE_FALLBACK.
//   This prevents abuse during outages while keeping cheap routes usable.
//
// SAFETY RULES:
//   1. balance < required         → block
//   2. balance - required < 0    → block  (no-negative double-check)
//   3. fallback + multi_agent    → block  (too expensive to risk)
//   4. fallback + reasoning      → block  (too expensive to risk)
//   5. PRECHECK log on every attempt
//   6. Idempotency key on every deduction

import { randomUUID } from 'crypto'

const BILLING_BASE = process.env.BILLING_SERVICE_URL ?? 'https://craudiovizai.com'

// ── Fail-open budget ──────────────────────────────────────────────────────────
// When billing is unreachable, users get exactly this many credits.
// Set to cover chat (1-2cr) and forge (3-6cr) but not team (25cr).
// Must be a positive integer. Never Infinity.
export const SAFE_FALLBACK_CREDITS = 10

// ── Model types blocked during billing outage ─────────────────────────────────
// These are too expensive to run without a confirmed real balance.
const FALLBACK_BLOCKED_MODEL_TYPES = new Set<ModelCostType>(['multi_agent', 'reasoning', 'image'])

// ── Base cost constants ───────────────────────────────────────────────────────
export const CREDIT_COSTS = {
  javari_chat:   1,
  javari_forge:  3,
  javari_team:   5,
  javari_worker: 0,
} as const

export type CreditSource = keyof typeof CREDIT_COSTS

// ── Model cost multipliers ────────────────────────────────────────────────────
export const MODEL_COST_MULTIPLIER = {
  cheap:       1,
  standard:    2,
  reasoning:   3,
  multi_agent: 5,
  image:       10,
} as const

export type ModelCostType = keyof typeof MODEL_COST_MULTIPLIER

// ── Route ceiling map ─────────────────────────────────────────────────────────
// Authoritative worst-case ModelCostType per route.
// Routes must never exceed their declared ceiling.
export const ROUTE_CEILING: Record<CreditSource, ModelCostType> = {
  javari_chat:   'standard',    // caps at moderate tier
  javari_forge:  'standard',    // caps at moderate tier (maxTier:'moderate')
  javari_team:   'multi_agent', // always multi_agent — no dynamic escalation
  javari_worker: 'cheap',       // exempt; ceiling is notional
}

// ── Tier → ModelCostType ──────────────────────────────────────────────────────
export function tierToModelCostType(tier: string): ModelCostType {
  switch (tier) {
    case 'free':
    case 'low':       return 'cheap'
    case 'moderate':  return 'standard'
    case 'expensive': return 'reasoning'
    default:          return 'cheap'  // unknown tier never overcharges
  }
}

// ── Cost calculation (logs COST_CALC) ─────────────────────────────────────────
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

// ── Balance result type ───────────────────────────────────────────────────────
// Separates real balance from fallback state.
// fallback: true means billing was unreachable — balance is SAFE_FALLBACK_CREDITS.
// fallback: false means balance is confirmed real.
interface BalanceResult {
  balance:  number
  fallback: boolean
}

// ── Internal: balance fetch with explicit fallback flag ───────────────────────
async function getCreditBalanceWithFallback(userId: string): Promise<BalanceResult> {
  try {
    const res = await fetch(
      `${BILLING_BASE}/api/billing/usage?userId=${encodeURIComponent(userId)}&feature=credits`,
      { method: 'GET', signal: AbortSignal.timeout(3000) }
    )

    if (!res.ok) {
      // HTTP error from billing service — treat as unavailable
      console.error('BILLING_UNAVAILABLE_FALLBACK', {
        userId:    userId.slice(0, 8) + '…',
        reason:    `billing service HTTP ${res.status}`,
        fallback:  SAFE_FALLBACK_CREDITS,
        timestamp: new Date().toISOString(),
      })
      return { balance: SAFE_FALLBACK_CREDITS, fallback: true }
    }

    const data = await res.json() as { month?: Record<string, number> }
    const balance = Math.max(0, data.month?.credits ?? 0)
    return { balance, fallback: false }

  } catch (err) {
    // Network error, timeout, DNS failure — treat as unavailable
    const reason = err instanceof Error ? err.message : String(err)
    console.error('BILLING_UNAVAILABLE_FALLBACK', {
      userId:    userId.slice(0, 8) + '…',
      reason,
      fallback:  SAFE_FALLBACK_CREDITS,
      timestamp: new Date().toISOString(),
    })
    return { balance: SAFE_FALLBACK_CREDITS, fallback: true }
  }
}

// ── Public: balance check ─────────────────────────────────────────────────────
// Returns Infinity only when userId is absent (unauthed — always allow).
// Returns SAFE_FALLBACK_CREDITS (not Infinity) when billing is unreachable.
// Returns confirmed real balance when billing is healthy.
export async function getCreditBalance(
  userId: string | null | undefined,
): Promise<number> {
  if (!userId) return Infinity  // unauthenticated — allow through, no billing needed

  const { balance } = await getCreditBalanceWithFallback(userId)
  return balance
}

// ── Pre-execution safety check (logs PRECHECK) ────────────────────────────────
export type PrecheckResult =
  | { allowed: true;  balance: number; required: number; requestId: string; fallback: boolean }
  | { allowed: false; balance: number; required: number; fallback: boolean;
      reason: 'insufficient' | 'would_go_negative' | 'billing_unavailable' }

/**
 * enforcePrecheck — MUST be called before every execution attempt.
 *
 * Checks (in order):
 *   1. During billing fallback: block multi_agent + reasoning routes
 *   2. balance >= required
 *   3. balance - required >= 0  (no-negative double-check)
 *
 * Emits PRECHECK log on every call regardless of outcome.
 * Returns requestId on allow — pass to deductCredits for idempotency.
 *
 * Fallback behaviour (billing unreachable):
 *   - cheap/standard routes: allowed if cost ≤ SAFE_FALLBACK_CREDITS
 *   - multi_agent/reasoning/image routes: always blocked
 */
export async function enforcePrecheck(
  userId: string | null | undefined,
  source: CreditSource,
  modelCostType?: ModelCostType,
): Promise<PrecheckResult> {
  const costType  = modelCostType ?? ROUTE_CEILING[source]
  const required  = computeCreditCost(source, costType)
  const requestId = userId
    ? `${source.replace('javari_', '')}-${Date.now()}-${randomUUID().slice(0, 8)}`
    : `anon-${randomUUID().slice(0, 8)}`

  // ── No userId: unauthenticated request — allow unconditionally ────────────
  if (!userId) {
    console.log('PRECHECK', {
      route:     source,
      required,
      balance:   'anon',
      allowed:   true,
      fallback:  false,
      requestId,
      timestamp: new Date().toISOString(),
    })
    return { allowed: true, balance: Infinity, required, requestId, fallback: false }
  }

  // ── Fetch balance with fallback flag ──────────────────────────────────────
  const { balance, fallback } = await getCreditBalanceWithFallback(userId)

  // ── Fallback mode: enforce cheap-only policy ──────────────────────────────
  // If billing is down, block expensive route types regardless of balance.
  // We cannot risk authorizing a multi_agent or reasoning run without a
  // confirmed real balance — the fallback budget of 10cr doesn't cover them.
  if (fallback && FALLBACK_BLOCKED_MODEL_TYPES.has(costType)) {
    console.log('PRECHECK', {
      route:     source,
      required,
      balance,
      allowed:   false,
      fallback:  true,
      reason:    'billing_unavailable',
      model_type: costType,
      requestId,
      timestamp: new Date().toISOString(),
    })
    return { allowed: false, balance, required, fallback: true, reason: 'billing_unavailable' }
  }

  // ── Log PRECHECK with full context ────────────────────────────────────────
  const wouldAllow = balance >= required && balance - required >= 0
  console.log('PRECHECK', {
    route:      source,
    required,
    balance,
    allowed:    wouldAllow,
    fallback,
    requestId,
    timestamp:  new Date().toISOString(),
  })

  // ── Guard 1: primary insufficiency ───────────────────────────────────────
  if (balance < required) {
    return { allowed: false, balance, required, fallback, reason: 'insufficient' }
  }

  // ── Guard 2: explicit no-negative double-check ────────────────────────────
  if (balance - required < 0) {
    return { allowed: false, balance, required, fallback, reason: 'would_go_negative' }
  }

  return { allowed: true, balance, required, requestId, fallback }
}

// ── Deduction (fire-and-forget, idempotency-keyed) ───────────────────────────
/**
 * Deduct credits after confirmed successful execution.
 * Fire-and-forget — never throws.
 *
 * @param userId    - user (no-op if falsy or cost=0)
 * @param cost      - exact cost from computeCreditCost() — never a magic number
 * @param source    - named route for audit trail
 * @param requestId - idempotency key from enforcePrecheck() — prevents double-charge
 */
export async function deductCredits(
  userId: string | null | undefined,
  cost: number,
  source: CreditSource,
  requestId?: string,
): Promise<void> {
  if (!userId) return
  if (cost <= 0) return

  const key = requestId ?? `fallback-${randomUUID()}`

  console.log('CREDITS_USED', {
    route:     source,
    cost,
    requestId: key,
    userId:    userId.slice(0, 8) + '…',
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
        metadata: {
          type:           'usage',
          source,
          cost,
          idempotencyKey: key,
        },
      }),
      signal: AbortSignal.timeout(3000),
    })
  } catch (err) {
    console.error('[billing/credits] deductCredits failed:', { source, cost, requestId: key, err })
  }
}

// ── Legacy compatibility shim ──────────────────────────────────────────────────
// Migrate callers to enforcePrecheck() when possible.
// Includes no-negative check; does NOT emit PRECHECK or enforce fallback policy.
export async function hasSufficientCredits(
  userId: string | null | undefined,
  required: number,
): Promise<boolean> {
  if (!userId) return true
  const balance = await getCreditBalance(userId)
  return balance >= required && balance - required >= 0
}
