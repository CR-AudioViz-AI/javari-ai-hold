// app/api/billing/monitor/route.ts
// Billing monitor inspection endpoint — admin only.
// GET  /api/billing/monitor          → last 100 events + summary stats
// GET  /api/billing/monitor?type=X   → filter by event type
// GET  /api/billing/monitor?window=5 → events in last N minutes
// POST /api/billing/monitor          → manually ingest test event (dev/staging only)
// Updated: March 21, 2026 — Initial implementation.

import { NextRequest, NextResponse } from 'next/server'
import { createClient }              from '@/lib/supabase/server'
import { ingestBillingEvent }        from '@/lib/billing/monitor'
import type { MonitorEventType }     from '@/lib/billing/monitor'

export const dynamic = 'force-dynamic'

// ── Auth guard — owner only ───────────────────────────────────────────────────
async function requireOwner(): Promise<string | null> {
  try {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return null

    const OWNER_EMAILS = [
      'royhenderson@craudiovizai.com',
      'roy@craudiovizai.com',
      'cindyhenderson@craudiovizai.com',
    ]
    if (!OWNER_EMAILS.includes((user.email ?? '').toLowerCase())) return null
    return user.id
  } catch {
    return null
  }
}

// ── GET — inspect recent events + stats ──────────────────────────────────────
export async function GET(req: NextRequest) {
  const ownerId = await requireOwner()
  if (!ownerId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(req.url)
  const filterType       = searchParams.get('type') as MonitorEventType | null
  const windowMinutes    = parseInt(searchParams.get('window') ?? '0') || 0
  const limit            = Math.min(parseInt(searchParams.get('limit') ?? '100'), 100)

  const supabase = createClient()

  let query = supabase
    .from('billing_monitor_events')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit)

  if (filterType) {
    query = query.eq('event_type', filterType)
  }

  if (windowMinutes > 0) {
    const since = new Date(Date.now() - windowMinutes * 60 * 1000).toISOString()
    query       = query.gte('created_at', since)
  }

  const { data: events, error } = await query
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // ── Summary stats ──────────────────────────────────────────────────────────
  const now5Min  = new Date(Date.now() - 5  * 60 * 1000).toISOString()
  const now60Min = new Date(Date.now() - 60 * 60 * 1000).toISOString()

  const typeCounts = (events ?? []).reduce<Record<string, number>>((acc, e) => {
    acc[e.event_type] = (acc[e.event_type] ?? 0) + 1
    return acc
  }, {})

  const recentEvents = events ?? []
  const last5min  = recentEvents.filter(e => e.created_at >= now5Min)
  const last60min = recentEvents.filter(e => e.created_at >= now60Min)

  const stats = {
    total_stored:        recentEvents.length,
    by_type:             typeCounts,
    last_5_minutes: {
      total:             last5min.length,
      billing_unavailable: last5min.filter(e => e.event_type === 'BILLING_UNAVAILABLE_FALLBACK').length,
      precheck_blocked:  last5min.filter(e => e.event_type === 'PRECHECK_BLOCKED').length,
      high_cost:         last5min.filter(e => e.event_type === 'CREDITS_USED_HIGH').length,
    },
    last_60_minutes: {
      total:             last60min.length,
      billing_unavailable: last60min.filter(e => e.event_type === 'BILLING_UNAVAILABLE_FALLBACK').length,
      precheck_blocked:  last60min.filter(e => e.event_type === 'PRECHECK_BLOCKED').length,
      high_cost:         last60min.filter(e => e.event_type === 'CREDITS_USED_HIGH').length,
    },
    most_recent_event:   recentEvents[0] ?? null,
    oldest_stored_event: recentEvents[recentEvents.length - 1] ?? null,
  }

  // ── Recent alerts ──────────────────────────────────────────────────────────
  const { data: alerts } = await supabase
    .from('billing_alerts')
    .select('level, subject, event_type, created_at')
    .order('created_at', { ascending: false })
    .limit(10)

  return NextResponse.json({
    stats,
    events:        recentEvents,
    recent_alerts: alerts ?? [],
    timestamp:     new Date().toISOString(),
  })
}

// ── POST — manual test event ingest (non-production guard) ───────────────────
export async function POST(req: NextRequest) {
  const ownerId = await requireOwner()
  if (!ownerId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Block in production unless explicitly overridden
  const isProd = process.env.VERCEL_ENV === 'production'
  const forceAllow = (await req.json().catch(() => ({}))).force === true

  if (isProd && !forceAllow) {
    return NextResponse.json({
      error: 'Manual test events blocked in production. Pass { force: true } to override.',
    }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const { type, route, cost, reason } = body

  if (!type) {
    return NextResponse.json({ error: 'type required' }, { status: 400 })
  }

  await ingestBillingEvent({
    type,
    route:     route    ?? 'test',
    userId:    'test000',
    cost:      cost     ?? undefined,
    reason:    reason   ?? 'manual_test',
    timestamp: new Date().toISOString(),
  })

  return NextResponse.json({ ok: true, message: 'Test event ingested' })
}
