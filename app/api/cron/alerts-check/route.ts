// app/api/cron/alerts-check/route.ts
// Billing monitor cron — runs every 5 minutes via Vercel Cron.
// Sweeps billing_monitor_events for persistent anomalies and re-fires
// alerts if conditions remain active. Separate from real-time ingest.
// GET /api/cron/alerts-check — Vercel Cron trigger
// Updated: March 21, 2026 — Billing monitor implementation.

import { NextRequest, NextResponse } from 'next/server'
import { createClient }              from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

const CRON_SECRET   = process.env.CRON_SECRET           ?? ''
const WEBHOOK_URL   = process.env.BILLING_ALERT_WEBHOOK_URL ?? ''
const ALERT_EMAIL   = process.env.BILLING_ALERT_EMAIL   ?? 'royhenderson@craudiovizai.com'
const RESEND_KEY    = process.env.RESEND_API_KEY         ?? ''
const ALERT_FROM    = process.env.BILLING_ALERT_FROM_EMAIL ?? 'alerts@craudiovizai.com'
const BILLING_BASE  = process.env.BILLING_SERVICE_URL   ?? 'https://craudiovizai.com'

// Thresholds — must match monitor.ts
const WINDOW_MINUTES              = 5
const FALLBACK_ALERT_THRESHOLD    = 3
const PRECHECK_BLOCK_THRESHOLD    = 10

function db() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export async function GET(req: NextRequest) {
  // Verify Vercel Cron or internal secret
  const authHeader = req.headers.get('authorization')
  if (CRON_SECRET && authHeader !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase    = db()
  const windowStart = new Date(Date.now() - WINDOW_MINUTES * 60 * 1000).toISOString()
  const issues: string[] = []

  // ── Check 1: billing unavailability ──────────────────────────────────────
  const { count: fallbackCount } = await supabase
    .from('billing_monitor_events')
    .select('id', { count: 'exact', head: true })
    .eq('event_type', 'BILLING_UNAVAILABLE_FALLBACK')
    .gte('created_at', windowStart)

  if ((fallbackCount ?? 0) >= FALLBACK_ALERT_THRESHOLD) {
    issues.push(`🔴 Billing unreachable: ${fallbackCount} events in ${WINDOW_MINUTES}m`)
  }

  // ── Check 2: precheck block spike ────────────────────────────────────────
  const { count: blockCount } = await supabase
    .from('billing_monitor_events')
    .select('id', { count: 'exact', head: true })
    .eq('event_type', 'PRECHECK_BLOCKED')
    .gte('created_at', windowStart)

  if ((blockCount ?? 0) >= PRECHECK_BLOCK_THRESHOLD) {
    issues.push(`🟡 Precheck blocks: ${blockCount} in ${WINDOW_MINUTES}m`)
  }

  // ── Check 3: any high-cost events ────────────────────────────────────────
  const { data: highCostEvents } = await supabase
    .from('billing_monitor_events')
    .select('route, cost, created_at')
    .eq('event_type', 'CREDITS_USED_HIGH')
    .gte('created_at', windowStart)
    .order('cost', { ascending: false })
    .limit(5)

  if (highCostEvents && highCostEvents.length > 0) {
    const top = highCostEvents[0]
    issues.push(`⚠️ High-cost deductions: ${highCostEvents.length} events (max: ${top.cost}cr on ${top.route})`)
  }

  // ── Nothing to report ─────────────────────────────────────────────────────
  if (issues.length === 0) {
    return NextResponse.json({
      ok:        true,
      checked:   true,
      issues:    0,
      window_minutes: WINDOW_MINUTES,
      timestamp: new Date().toISOString(),
    })
  }

  // ── Build digest message ──────────────────────────────────────────────────
  const subject = `📊 Billing Monitor Digest — ${issues.length} issue${issues.length !== 1 ? 's' : ''} detected`
  const body    = [
    `Billing monitor sweep completed at ${new Date().toISOString()}`,
    `Window: last ${WINDOW_MINUTES} minutes`,
    '',
    'Issues detected:',
    ...issues.map(i => `  ${i}`),
    '',
    `Inspect: ${BILLING_BASE.replace('craudiovizai.com', 'javari-ai')}/api/billing/monitor`,
    `Dashboard: https://craudiovizai.com/admin/billing`,
  ].join('\n')

  // ── Store digest alert ────────────────────────────────────────────────────
  await supabase.from('billing_alerts').insert({
    level:        issues.some(i => i.includes('🔴')) ? 'critical' : 'warning',
    subject,
    body,
    event_type:   'CRON_DIGEST',
    trigger_data: { issues, fallback_count: fallbackCount, block_count: blockCount },
    created_at:   new Date().toISOString(),
  }).catch(() => {})

  // ── Webhook ───────────────────────────────────────────────────────────────
  if (WEBHOOK_URL) {
    const color = issues.some(i => i.includes('🔴')) ? 0xFF0000 : 0xFFA500
    await fetch(WEBHOOK_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        embeds: [{
          title:       subject,
          description: body.slice(0, 2000),
          color,
          footer:      { text: `javari-ai billing cron • ${new Date().toISOString()}` },
        }],
      }),
      signal: AbortSignal.timeout(5000),
    }).catch(err => console.error('[alerts-cron] webhook failed:', err))
  }

  // ── Email ─────────────────────────────────────────────────────────────────
  if (RESEND_KEY && ALERT_EMAIL) {
    await fetch('https://api.resend.com/emails', {
      method:  'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_KEY}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({
        from:    ALERT_FROM,
        to:      [ALERT_EMAIL],
        subject,
        text:    body,
        html:    `<pre style="font-family:monospace;white-space:pre-wrap">${body}</pre>`,
      }),
      signal: AbortSignal.timeout(5000),
    }).catch(err => console.error('[alerts-cron] email failed:', err))
  }

  console.log('BILLING_MONITOR_DIGEST', { issues, timestamp: new Date().toISOString() })

  return NextResponse.json({
    ok:        true,
    checked:   true,
    issues:    issues.length,
    details:   issues,
    alerted:   true,
    timestamp: new Date().toISOString(),
  })
}
