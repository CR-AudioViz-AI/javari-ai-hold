// lib/billing/credits.ts
// Credit consumption helpers — check balance and deduct on successful use.
// Calls craudiovizai.com as central billing authority.
// Updated: March 21, 2026 — Billing monitor integration.
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
//   Routes costing  > 10cr OR type = multi_agent/reasoning/image: BLOCKED.
//   BILLING_UNAVAILABLE_FALLBACK logged + ingested to monitor.
//
// SAFETY RULES:
//   1. balance < required         → block
//   2. balance - required < 0    → block  (no-negative double-check)
//   3. fallback + blocked_type   → block
//   4. PRECHECK log + monitor ingest on every blocked attempt
//   5. Idempotency key on every deduction
//   6. CREDITS_USED_HIGH monitor event when cost > ANOMALY_COST_THRESHOLD

import { randomUUID } from 'crypto'
import { ingestBillingEvent } from './monitor'

const BILLING_BASE = process.env.BILLING_SERVICE_URL ?? 'https://craudiovizai.com'

// Cost above which a single deduction triggers a monitor anomaly alert
const ANOMALY_COST_THRESHOLD = 20

// ── Fail-open budget ──────────────────────────────────────────────────────────
export const SAFE_FALLBACK_CREDITS = 10

// Model types blocked during billing outage
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
export const ROUTE_CEILING: Record<CreditSource, ModelCostType> = {
  javari_chat:   'standard',
  javari_forge:  'standard',
  javari_team:   'multi_agent',
  javari_worker: 'cheap',
}

// ── Tier → ModelCostType ──────────────────────────────────────────────────────
export function tierToModelCostType(tier: string): ModelCostType {
  switch (tier) {
    case 'free':
    case 'low':       return 'cheap'
    case 'moderate':  return 'standard'
    case 'expensive': return 'reasoning'
    default:          return 'cheap'
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
interface BalanceResult {
  balance:  number
  fallback: boolean
}

// ── Internal: balance fetch with explicit fallback flag + monitor ingest ──────
async function getCreditBalanceWithFallback(userId: string): Promise<BalanceResult> {
  try {
    const res = await fetch(
      `${BILLING_BASE}/api/billing/usage?userId=${encodeURIComponent(userId)}&feature=credits`,
      { method: 'GET', signal: AbortSignal.timeout(3000) }
    )

    if (!res.ok) {
      const reason = `billing service HTTP ${res.status}`
      console.error('BILLING_UNAVAILABLE_FALLBACK', {
        userId:    userId.slice(0, 8) + '…',
        reason,
        fallback:  SAFE_FALLBACK_CREDITS,
        timestamp: new Date().toISOString(),
      })
      // ── Monitor ingest ──────────────────────────────────────────────────
      ingestBillingEvent({
        type:     'BILLING_UNAVAILABLE_FALLBACK',
        userId:   userId.slice(0, 8),
        reason,
        fallback: true,
        metadata: { status: res.status },
        timestamp: new Date().toISOString(),
      }).catch(() => {})
      return { balance: SAFE_FALLBACK_CREDITS, fallback: true }
    }

    const data    = await res.json() as { month?: Record<string, number> }
    const balance = Math.max(0, data.month?.credits ?? 0)
    return { balance, fallback: false }

  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    console.error('BILLING_UNAVAILABLE_FALLBACK', {
      userId:    userId.slice(0, 8) + '…',
      reason,
      fallback:  SAFE_FALLBACK_CREDITS,
      timestamp: new Date().toISOString(),
    })
    // ── Monitor ingest ────────────────────────────────────────────────────
    ingestBillingEvent({
      type:      'BILLING_UNAVAILABLE_FALLBACK',
      userId:    userId.slice(0, 8),
      reason,
      fallback:  true,
      timestamp: new Date().toISOString(),
    }).catch(() => {})
    return { balance: SAFE_FALLBACK_CREDITS, fallback: true }
  }
}

// ── Public: balance check ─────────────────────────────────────────────────────
export async function getCreditBalance(
  userId: string | null | undefined,
): Promise<number> {
  if (!userId) return Infinity
  const { balance } = await getCreditBalanceWithFallback(userId)
  return balance
}

// ── Pre-execution safety check ────────────────────────────────────────────────
export type PrecheckResult =
  | { allowed: true;  balance: number; required: number; requestId: string; fallback: boolean }
  | { allowed: false; balance: number; required: number; fallback: boolean;
      reason: 'insufficient' | 'would_go_negative' | 'billing_unavailable' }

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

  if (!userId) {
    console.log('PRECHECK', {
      route: source, required, balance: 'anon',
      allowed: true, fallback: false, requestId,
      timestamp: new Date().toISOString(),
    })
    return { allowed: true, balance: Infinity, required, requestId, fallback: false }
  }

  const { balance, fallback } = await getCreditBalanceWithFallback(userId)

  // ── Fallback: block expensive route types ──────────────────────────────────
  if (fallback && FALLBACK_BLOCKED_MODEL_TYPES.has(costType)) {
    console.log('PRECHECK', {
      route: source, required, balance, allowed: false,
      fallback: true, reason: 'billing_unavailable', model_type: costType,
      requestId, timestamp: new Date().toISOString(),
    })
    // ── Monitor ingest ──────────────────────────────────────────────────────
    ingestBillingEvent({
      type:     'PRECHECK_BLOCKED',
      route:    source,
      userId:   userId.slice(0, 8),
      required,
      balance,
      reason:   'billing_unavailable',
      fallback: true,
      timestamp: new Date().toISOString(),
    } as any).catch(() => {})
    return { allowed: false, balance, required, fallback: true, reason: 'billing_unavailable' }
  }

  const wouldAllow = balance >= required && balance - required >= 0
  console.log('PRECHECK', {
    route: source, required, balance, allowed: wouldAllow,
    fallback, requestId, timestamp: new Date().toISOString(),
  })

  if (balance < required) {
    // ── Monitor ingest on block ─────────────────────────────────────────────
    ingestBillingEvent({
      type:     'PRECHECK_BLOCKED',
      route:    source,
      userId:   userId.slice(0, 8),
      required,
      balance,
      reason:   'insufficient',
      fallback,
      timestamp: new Date().toISOString(),
    } as any).catch(() => {})
    return { allowed: false, balance, required, fallback, reason: 'insufficient' }
  }

  if (balance - required < 0) {
    ingestBillingEvent({
      type:     'PRECHECK_BLOCKED',
      route:    source,
      userId:   userId.slice(0, 8),
      required,
      balance,
      reason:   'would_go_negative',
      fallback,
      timestamp: new Date().toISOString(),
    } as any).catch(() => {})
    return { allowed: false, balance, required, fallback, reason: 'would_go_negative' }
  }

  return { allowed: true, balance, required, requestId, fallback }
}

// ── Deduction ─────────────────────────────────────────────────────────────────
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
    route: source, cost, requestId: key,
    userId: userId.slice(0, 8) + '…',
    timestamp: new Date().toISOString(),
  })

  // ── Monitor: anomaly alert on high single deduction ───────────────────────
  if (cost > ANOMALY_COST_THRESHOLD) {
    ingestBillingEvent({
      type:      'CREDITS_USED_HIGH',
      route:     source,
      userId:    userId.slice(0, 8),
      cost,
      metadata:  { requestId: key, threshold: ANOMALY_COST_THRESHOLD },
      timestamp: new Date().toISOString(),
    }).catch(() => {})
  }

  try {
    await fetch(`${BILLING_BASE}/api/billing/usage`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        userId,
        feature:  'credits',
        count:    -cost,
        metadata: { type: 'usage', source, cost, idempotencyKey: key },
      }),
      signal: AbortSignal.timeout(3000),
    })
  } catch (err) {
    console.error('[billing/credits] deductCredits failed:', { source, cost, requestId: key, err })
  }
}

// ── Legacy shim ───────────────────────────────────────────────────────────────
export async function hasSufficientCredits(
  userId: string | null | undefined,
  required: number,
): Promise<boolean> {
  if (!userId) return true
  const balance = await getCreditBalance(userId)
  return balance >= required && balance - required >= 0
}
