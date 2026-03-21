// lib/billing/credits.ts
// Credit consumption helpers — check balance and deduct on successful use.
// Calls craudiovizai.com as central billing authority.
// Updated: March 21, 2026 — Credit cost enforcement audit.
//
// COST SCHEDULE (per Henderson Standard — zero flat-cost paths):
//   javari_chat  : 1 credit per non-first-turn message
//   javari_forge : 3 credits per code generation (higher model cost)
//   javari_team  : 5 credits per ensemble (3 model calls: plan + build + validate)
//   javari_worker: 0 credits (internal system worker — exempt by policy)

const BILLING_BASE = process.env.BILLING_SERVICE_URL ?? 'https://craudiovizai.com'

// ── Named cost constants — never use magic numbers in route files ─────────────
export const CREDIT_COSTS = {
  javari_chat:   1,   // 1 credit / message (non-first-turn)
  javari_forge:  3,   // 3 credits / generation (moderate model, complex output)
  javari_team:   5,   // 5 credits / ensemble (3 sequential AI calls)
  javari_worker: 0,   // Internal system worker — explicitly exempt
} as const

export type CreditSource = keyof typeof CREDIT_COSTS

/**
 * Check current credit balance for a user.
 * Returns balance >= 0, or Infinity if userId not provided (graceful degradation).
 */
export async function getCreditBalance(
  userId: string | null | undefined,
): Promise<number> {
  if (!userId) return Infinity  // no userId = allow through

  try {
    const res = await fetch(
      `${BILLING_BASE}/api/billing/usage?userId=${encodeURIComponent(userId)}&feature=credits`,
      { method: 'GET', signal: AbortSignal.timeout(3000) }
    )
    if (!res.ok) return Infinity  // fail open on billing error

    const data = await res.json() as { today?: Record<string, number>; month?: Record<string, number> }
    const monthTotal = data.month?.credits ?? 0
    return Math.max(0, monthTotal)
  } catch {
    return Infinity  // network error — fail open
  }
}

/**
 * Deduct a variable number of credits after successful feature execution.
 * Fire-and-forget — never throws. Call ONLY after confirmed success.
 *
 * @param userId  - user performing the action (no-op if falsy)
 * @param cost    - exact credit cost from CREDIT_COSTS constant
 * @param source  - named source for audit trail
 */
export async function deductCredits(
  userId: string | null | undefined,
  cost: number,
  source: CreditSource,
): Promise<void> {
  if (!userId) return
  if (cost <= 0) return  // Zero-cost paths (e.g. worker) are explicit no-ops

  console.log('CREDITS_USED', {
    route:     source,
    cost,
    userId:    userId.slice(0, 8) + '…',  // partial ID — never log full PII
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
    // Fire-and-forget — log but never throw
    console.error('[billing/credits] deductCredits failed:', { source, cost, err })
  }
}

/**
 * Check whether a user has at least `required` credits before executing AI.
 * Returns true if userId is absent (fail open for unauthed requests).
 */
export async function hasSufficientCredits(
  userId: string | null | undefined,
  required: number,
): Promise<boolean> {
  if (!userId) return true
  const balance = await getCreditBalance(userId)
  return balance >= required
}
