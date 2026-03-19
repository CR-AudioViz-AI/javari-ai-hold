// app/api/billing/subscription/route.ts
// GET  ?userId= — returns current subscription for a user
// POST { userId } — same but via POST for auth context
// Thursday, March 19, 2026
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function db() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

const FREE_SUB = {
  plan_tier: 'free',
  status:    'active',
  provider:  'none',
  current_period_end: null,
}

export async function GET(req: NextRequest) {
  try {
    const userId = req.nextUrl.searchParams.get('userId')
    if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 })

    const supabase = db()
    const { data, error } = await supabase
      .from('user_subscriptions')
      .select('id, user_id, provider, provider_subscription_id, plan_tier, status, current_period_end, created_at, updated_at')
      .eq('user_id', userId)
      .eq('status', 'active')
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (error) throw new Error(error.message)

    const sub = data ?? FREE_SUB
    const isActive = sub.status === 'active' && (
      !sub.current_period_end || sub.current_period_end > Date.now()
    )

    return NextResponse.json({
      ...sub,
      is_active: isActive,
      is_paid:   sub.plan_tier !== 'free',
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const url  = new URL(req.url)
  url.searchParams.set('userId', body.userId ?? '')
  return GET(new NextRequest(url, req))
}
