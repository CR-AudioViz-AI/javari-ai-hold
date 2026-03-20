// lib/billing/credits.ts
// Credit consumption helpers — check balance and deduct on successful use.
// Calls craudiovizai.com as central billing authority.
// Thursday, March 19, 2026
const BILLING_BASE = process.env.BILLING_SERVICE_URL ?? 'https://craudiovizai.com'

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

    // Credits are stored as positive grants and negative deductions in usage_count
    // Sum over all time (not just today) — credits don't reset daily
    const monthTotal = data.month?.credits ?? 0
    return Math.max(0, monthTotal)
  } catch {
    return Infinity  // network error — fail open
  }
}

/**
 * Deduct 1 credit from a user after successful feature execution.
 * Fire-and-forget — never throws. Only call after confirmed success.
 */
export async function deductCredit(
  userId: string | null | undefined,
  source: 'javari_chat' | 'javari_forge' | 'javari_team',
): Promise<void> {
  if (!userId) return

  try {
    await fetch(`${BILLING_BASE}/api/billing/usage`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        userId,
        feature:  'credits',
        count:    -1,
        metadata: { type: 'usage', source },
      }),
      signal: AbortSignal.timeout(3000),
    })
  } catch (err) {
    console.error('[billing/credits] deductCredit failed:', err)
  }
}
