// lib/billing/credits.ts
// Credit consumption helpers — check balance and deduct on successful use.
// Calls craudiovizai.com as central billing authority.
// Updated: March 21, 2026 — Final safety lock (enforcePrecheck, idempotency, PRECHECK log).
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
//   chat  → standard  (1 × 2 =  2)
//   forge → standard  (3 × 2 =  6)
//   team  → multi_agent (5 × 5 = 25)  [always fixed, not dynamic]
//
// SAFETY RULES (all enforced in enforcePrecheck):
//   1. balance < required    → block
//   2. balance - required < 0 → block  (explicit no-negative double-check)
//   3. PRECHECK log emitted before every execution attempt
//   4. Idempotency key on every deduction — same requestId cannot deduct twice

import { randomUUID } from 'crypto'

const BILLING_BASE = process.env.BILLING_SERVICE_URL ?? 'https://craudiovizai.com'

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

// ── Route ceiling map — authoritative pre-check ceilings per route ────────────
// Each entry is the worst-case ModelCostType for that route.
// Routes must never exceed their declared ceiling.
export const ROUTE_CEILING: Record<CreditSource, ModelCostType> = {
  javari_chat:   'standard',    // chat caps at moderate tier
  javari_forge:  'standard',    // forge caps at moderate tier (maxTier:'moderate')
  javari_team:   'multi_agent', // team is always multi_agent — no dynamic escalation
  javari_worker: 'cheap',       // worker is exempt; ceiling is notional only
}

// ── Tier → ModelCostType ──────────────────────────────────────────────────────
export function tierToModelCostType(tier: string): ModelCostType {
  switch (tier) {
    case 'free':
    case 'low':       return 'cheap'
    case 'moderate':  return 'standard'
    case 'expensive': return 'reasoning'
    default:          return 'cheap'  // fail safe — unknown tier never overcharges
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

// ── Pre-execution safety check (logs PRECHECK, enforces no-negative) ──────────
export type PrecheckResult =
  | { allowed: true;  balance: number; required: number; requestId: string }
  | { allowed: false; balance: number; required: number; reason: 'insufficient' | 'would_go_negative' | 'billing_unavailable' }

/**
 * enforcePrecheck — MUST be called before every execution attempt.
 *
 * Checks:
 *   1. balance >= required         (primary guard)
 *   2. balance - required >= 0     (explicit no-negative double-check)
 *
 * Emits PRECHECK log regardless of outcome — every attempt is traceable.
 * Returns a typed result; routes must check `allowed` before proceeding.
 * Returns a unique requestId on success — pass to deductCredits for idempotency.
 *
 * If userId is absent: allowed = true, requestId = 'anon-{uuid}'.
 * If billing service is unreachable: allowed = true (fail open — never block users).
 */
export async function enforcePrecheck(
  userId: string | null | undefined,
  source: CreditSource,
  modelCostType?: ModelCostType,  // if omitted, uses ROUTE_CEILING[source]
): Promise<PrecheckResult> {
  const costType = modelCostType ?? ROUTE_CEILING[source]
  const required = computeCreditCost(source, costType)
  const requestId = userId
    ? `${source.replace('javari_', '')}-${Date.now()}-${randomUUID().slice(0, 8)}`
    : `anon-${randomUUID().slice(0, 8)}`

  // No userId — allow, no balance fetch needed
  if (!userId) {
    console.log('PRECHECK', {
      route:     source,
      required,
      balance:   'anon',
      allowed:   true,
      requestId,
      timestamp: new Date().toISOString(),
    })
    return { allowed: true, balance: Infinity, required, requestId }
  }

  const balance = await getCreditBalance(userId)

  // Billing service unreachable returns Infinity — fail open, log it
  const billingUnavailable = balance === Infinity
  const effectiveBalance   = billingUnavailable ? Infinity : balance

  console.log('PRECHECK', {
    route:               source,
    required,
    balance:             billingUnavailable ? 'billing_unavailable' : balance,
    allowed:             billingUnavailable ? true : effectiveBalance >= required && effectiveBalance - required >= 0,
    requestId,
    billing_unavailable: billingUnavailable,
    timestamp:           new Date().toISOString(),
  })

  if (billingUnavailable) {
    // Fail open — billing errors never block execution
    return { allowed: true, balance: Infinity, required, requestId }
  }

  // Guard 1: primary insufficiency check
  if (effectiveBalance < required) {
    return { allowed: false, balance: effectiveBalance, required, reason: 'insufficient' }
  }

  // Guard 2: explicit no-negative double-check
  // This catches floating-point edge cases and any scenario where
  // guard 1 could theoretically pass while the result would still go negative.
  if (effectiveBalance - required < 0) {
    return { allowed: false, balance: effectiveBalance, required, reason: 'would_go_negative' }
  }

  return { allowed: true, balance: effectiveBalance, required, requestId }
}

// ── Balance check (raw, non-blocking) ─────────────────────────────────────────
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
    return Infinity  // network error — fail open
  }
}

// ── Deduction (fire-and-forget, idempotency-keyed) ───────────────────────────
/**
 * Deduct credits after confirmed successful execution.
 * Fire-and-forget — never throws.
 *
 * @param userId      - user (no-op if falsy or cost=0)
 * @param cost        - exact cost from computeCreditCost() — never a magic number
 * @param source      - named route for audit trail
 * @param requestId   - idempotency key from enforcePrecheck() — prevents double-charge
 *                      If absent a new UUID is generated (allows deduction but loses idempotency).
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
    route:      source,
    cost,
    requestId:  key,
    userId:     userId.slice(0, 8) + '…',  // partial ID — never full PII
    timestamp:  new Date().toISOString(),
  })

  try {
    await fetch(`${BILLING_BASE}/api/billing/usage`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        userId,
        feature:          'credits',
        count:            -cost,
        metadata: {
          type:           'usage',
          source,
          cost,
          idempotencyKey: key,  // billing authority uses this to deduplicate
        },
      }),
      signal: AbortSignal.timeout(3000),
    })
  } catch (err) {
    console.error('[billing/credits] deductCredits failed:', { source, cost, requestId: key, err })
  }
}

// ── Legacy compatibility shim ──────────────────────────────────────────────────
// Routes that haven't migrated to enforcePrecheck() yet can still call this.
// It does NOT emit PRECHECK or enforce no-negative — migrate routes as you go.
export async function hasSufficientCredits(
  userId: string | null | undefined,
  required: number,
): Promise<boolean> {
  if (!userId) return true
  const balance = await getCreditBalance(userId)
  return balance >= required && balance - required >= 0
}
