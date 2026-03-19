// app/api/billing/usage/route.ts
// POST { userId, feature, count? } — record feature usage
// GET  ?userId=&feature= — get usage summary for today + this month
// Thursday, March 19, 2026
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function db() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

export async function POST(req: NextRequest) {
  try {
    const { userId, feature, count = 1, metadata = {} } =
      await req.json() as { userId: string; feature: string; count?: number; metadata?: Record<string, unknown> }

    if (!userId || !feature) {
      return NextResponse.json({ error: 'userId and feature required' }, { status: 400 })
    }
    if (count < 1 || count > 1000) {
      return NextResponse.json({ error: 'count must be between 1 and 1000' }, { status: 400 })
    }

    const supabase = db()
    const { error } = await supabase.from('usage_ledger').insert({
      user_id:     userId,
      feature,
      usage_count: count,
      metadata,
    })

    if (error) throw new Error(error.message)
    return NextResponse.json({ ok: true, recorded: count })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function GET(req: NextRequest) {
  try {
    const userId  = req.nextUrl.searchParams.get('userId')
    const feature = req.nextUrl.searchParams.get('feature')
    if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 })

    const supabase = db()

    const todayStart = new Date(); todayStart.setUTCHours(0, 0, 0, 0)
    const monthStart = new Date(); monthStart.setUTCDate(1); monthStart.setUTCHours(0, 0, 0, 0)

    let query = supabase
      .from('usage_ledger')
      .select('feature, usage_count, created_at')
      .eq('user_id', userId)
      .gte('created_at', monthStart.toISOString())

    if (feature) query = query.eq('feature', feature)

    const { data: rows, error } = await query
    if (error) throw new Error(error.message)

    const today: Record<string, number> = {}
    const month: Record<string, number> = {}
    const todayTs = todayStart.getTime()

    for (const row of rows ?? []) {
      month[row.feature] = (month[row.feature] ?? 0) + row.usage_count
      if (new Date(row.created_at).getTime() >= todayTs) {
        today[row.feature] = (today[row.feature] ?? 0) + row.usage_count
      }
    }

    return NextResponse.json({ userId, today, month, timestamp: new Date().toISOString() })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
