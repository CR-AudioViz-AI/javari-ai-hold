// lib/billing/gate.ts
// Inline billing gate — checks entitlement and tracks usage.
// Used by chat, team, and forge routes. No HTTP round-trip.
// Thursday, March 19, 2026
import { createClient } from '@supabase/supabase-js'

function db() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

// Daily limits per plan tier — matches /api/billing/entitlement
const DAILY_LIMITS: Record<string, Record<string, number>> = {
  free:  { javari_chat: 10,  javari_forge: 5,   javari_team: 3  },
  pro:   { javari_chat: 500, javari_forge: 100,  javari_team: 100 },
  power: { javari_chat: -1,  javari_forge: -1,   javari_team: -1  }, // -1 = unlimited
}

export type GateResult =
  | { allowed: true;  tier: string; used: number; limit: number }
  | { allowed: false; tier: string; used: number; limit: number; error: 'upgrade_required'; message: string; upgrade_url: string }

/**
 * Check whether a user can use a feature right now.
 * If userId is not provided, allows the request (graceful degradation).
 */
export async function checkGate(
  userId: string | null | undefined,
  feature: 'javari_chat' | 'javari_forge' | 'javari_team',
): Promise<GateResult> {
  // No userId — allow gracefully (logged-out or system call)
  if (!userId) {
    return { allowed: true, tier: 'free', used: 0, limit: DAILY_LIMITS.free[feature] ?? 10 }
  }

  const supabase = db()

  // Get subscription tier
  const { data: sub } = await supabase
    .from('user_subscriptions')
    .select('plan_tier, status, current_period_end')
    .eq('user_id', userId)
    .eq('status', 'active')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const tier = (sub?.plan_tier && sub.plan_tier !== 'free'
    && sub.status === 'active'
    && (!sub.current_period_end || sub.current_period_end > Date.now()))
    ? sub.plan_tier
    : 'free'

  const limit = (DAILY_LIMITS[tier] ?? DAILY_LIMITS.free)[feature] ?? 10

  // Unlimited tier — allow immediately, no usage query needed
  if (limit === -1) {
    return { allowed: true, tier, used: 0, limit: -1 }
  }

  // Get today's usage
  const todayStart = new Date()
  todayStart.setUTCHours(0, 0, 0, 0)

  const { data: usageRows } = await supabase
    .from('usage_ledger')
    .select('usage_count')
    .eq('user_id', userId)
    .eq('feature', feature)
    .gte('created_at', todayStart.toISOString())

  const used = (usageRows ?? []).reduce((s, r) => s + (r.usage_count ?? 0), 0)

  if (used >= limit) {
    return {
      allowed:     false,
      tier,
      used,
      limit,
      error:       'upgrade_required',
      message:     tier === 'free'
        ? `You have used all ${limit} free ${feature.replace('_', ' ')} requests for today. Upgrade to Pro for up to ${DAILY_LIMITS.pro[feature] ?? 500}/day.`
        : `Daily limit of ${limit} reached for your ${tier} plan. Resets at midnight UTC.`,
      upgrade_url: '/pricing',
    }
  }

  return { allowed: true, tier, used, limit }
}

/**
 * Record one unit of feature usage for a user.
 * Fire-and-forget safe — errors are logged but do not propagate.
 */
export async function trackUsage(
  userId: string | null | undefined,
  feature: 'javari_chat' | 'javari_forge' | 'javari_team',
  count = 1,
): Promise<void> {
  if (!userId) return
  try {
    const supabase = db()
    await supabase.from('usage_ledger').insert({
      user_id:     userId,
      feature,
      usage_count: count,
    })
  } catch (err) {
    console.error('[billing/gate] trackUsage failed:', err)
  }
}
