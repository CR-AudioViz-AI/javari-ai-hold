// app/api/billing/entitlement/route.ts
// GET ?userId= — returns feature gates and usage limits for a user.
// Used by all gated features to check access before execution.
// Thursday, March 19, 2026
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function db() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

// Feature limits per plan tier
const LIMITS: Record<string, Record<string, number>> = {
  free: {
    javari_chat:    10,   // queries per day
    javari_forge:   5,
    image_gen:      2,
    api_calls:      0,    // no API access on free
    team_members:   1,
    workspaces:     1,
  },
  pro: {
    javari_chat:    500,
    javari_forge:   100,
    image_gen:      50,
    api_calls:      1000,
    team_members:   5,
    workspaces:     3,
  },
  power: {
    javari_chat:    -1,   // unlimited (-1)
    javari_forge:   -1,
    image_gen:      200,
    api_calls:      10000,
    team_members:   25,
    workspaces:     -1,
  },
}

const FEATURES: Record<string, string[]> = {
  free:  ['javari_chat', 'javari_forge'],
  pro:   ['javari_chat', 'javari_forge', 'image_gen', 'api_calls', 'priority_support', 'advanced_models'],
  power: ['javari_chat', 'javari_forge', 'image_gen', 'api_calls', 'priority_support', 'advanced_models',
          'white_label', 'multi_workspace', 'sso', 'custom_branding'],
}

export async function GET(req: NextRequest) {
  try {
    const userId = req.nextUrl.searchParams.get('userId')
    if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 })

    const supabase = db()

    // Get subscription
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

    // Get today usage from usage_ledger
    const todayStart = new Date()
    todayStart.setUTCHours(0, 0, 0, 0)

    const { data: usageRows } = await supabase
      .from('usage_ledger')
      .select('feature, usage_count')
      .eq('user_id', userId)
      .gte('created_at', todayStart.toISOString())

    const todayUsage: Record<string, number> = {}
    for (const row of usageRows ?? []) {
      todayUsage[row.feature] = (todayUsage[row.feature] ?? 0) + row.usage_count
    }

    // Build entitlement response
    const limits   = LIMITS[tier]   ?? LIMITS.free
    const features = FEATURES[tier] ?? FEATURES.free

    const usage: Record<string, { used: number; limit: number; remaining: number; blocked: boolean }> = {}
    for (const [feature, limit] of Object.entries(limits)) {
      const used      = todayUsage[feature] ?? 0
      const remaining = limit === -1 ? -1 : Math.max(0, limit - used)
      usage[feature]  = { used, limit, remaining, blocked: limit !== -1 && used >= limit }
    }

    return NextResponse.json({
      user_id:           userId,
      tier,
      features,
      usage,
      is_paid:           tier !== 'free',
      subscription_active: tier !== 'free',
      timestamp:         new Date().toISOString(),
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
