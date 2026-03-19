// lib/billing/gate.ts
// Billing gate — calls craudiovizai.com as central billing authority.
// No local Supabase queries. All entitlement logic lives in craudiovizai.
// Thursday, March 19, 2026
const BILLING_BASE = process.env.BILLING_SERVICE_URL ?? 'https://craudiovizai.com'

export type GateResult =
  | { allowed: true;  tier: string; used: number; limit: number }
  | { allowed: false; tier: string; used: number; limit: number; error: 'upgrade_required'; message: string; upgrade_url: string }

/**
 * Check whether a user can use a feature right now.
 * Calls craudiovizai.com/api/billing/entitlement.
 * If userId is not provided or the request fails, allows the request (graceful degradation).
 */
export async function checkGate(
  userId: string | null | undefined,
  feature: 'javari_chat' | 'javari_forge' | 'javari_team',
): Promise<GateResult> {
  if (!userId) {
    return { allowed: true, tier: 'free', used: 0, limit: 10 }
  }

  try {
    const res = await fetch(
      `${BILLING_BASE}/api/billing/entitlement?userId=${encodeURIComponent(userId)}&feature=${feature}`,
      {
        method:  'GET',
        headers: { 'Content-Type': 'application/json' },
        // Short timeout — billing must never block the user longer than this
        signal: AbortSignal.timeout(3000),
      }
    )

    if (!res.ok) {
      // Billing service error — fail open
      console.error('[billing/gate] entitlement returned', res.status)
      return { allowed: true, tier: 'free', used: 0, limit: 10 }
    }

    const data = await res.json() as GateResult & { error_note?: string }

    // If billing service itself failed open, treat as allowed
    if (data.allowed === false) {
      return {
        allowed:     false,
        tier:        data.tier,
        used:        data.used,
        limit:       data.limit,
        error:       'upgrade_required',
        message:     (data as { message?: string }).message ?? 'Upgrade required',
        upgrade_url: (data as { upgrade_url?: string }).upgrade_url ?? '/pricing',
      }
    }

    return { allowed: true, tier: data.tier, used: data.used, limit: data.limit }

  } catch (err) {
    // Network error, timeout, etc. — fail open, never block user
    console.error('[billing/gate] checkGate failed:', err)
    return { allowed: true, tier: 'free', used: 0, limit: 10 }
  }
}

/**
 * Record one unit of feature usage.
 * POSTs to craudiovizai.com/api/billing/usage. Fire-and-forget.
 */
export async function trackUsage(
  userId: string | null | undefined,
  feature: 'javari_chat' | 'javari_forge' | 'javari_team',
  count = 1,
): Promise<void> {
  if (!userId) return
  try {
    await fetch(`${BILLING_BASE}/api/billing/usage`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ userId, feature, count }),
      signal:  AbortSignal.timeout(3000),
    })
  } catch (err) {
    console.error('[billing/gate] trackUsage failed:', err)
  }
}
