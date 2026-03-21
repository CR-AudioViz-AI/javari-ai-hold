// lib/billing/monitor.ts
// Billing log monitor — ingest, store, and alert on billing anomalies.
// Updated: March 21, 2026 — Initial implementation.
//
// THREE EVENT TYPES WATCHED:
//   BILLING_UNAVAILABLE_FALLBACK  → billing service unreachable
//   PRECHECK_BLOCKED              → enforcePrecheck returned allowed:false
//   CREDITS_USED_HIGH             → single deduction above ANOMALY_COST_THRESHOLD
//
// ALERT CONDITIONS (within ALERT_WINDOW_MINUTES):
//   ≥ FALLBACK_ALERT_THRESHOLD consecutive BILLING_UNAVAILABLE events → alert
//   ≥ PRECHECK_BLOCK_THRESHOLD   PRECHECK blocked events              → alert
//   any CREDITS_USED_HIGH event                                       → immediate alert
//
// STORAGE: billing_monitor_events table, capped at MAX_STORED_EVENTS (100).
// DELIVERY: POST to BILLING_ALERT_WEBHOOK_URL + Resend email to BILLING_ALERT_EMAIL.

import { createClient } from '@supabase/supabase-js'

// ── Configuration — change via env vars, never hardcode ──────────────────────
const BILLING_BASE           = process.env.BILLING_SERVICE_URL         ?? 'https://craudiovizai.com'
const ALERT_WEBHOOK_URL      = process.env.BILLING_ALERT_WEBHOOK_URL   ?? ''
const ALERT_EMAIL            = process.env.BILLING_ALERT_EMAIL         ?? 'royhenderson@craudiovizai.com'
const RESEND_API_KEY         = process.env.RESEND_API_KEY               ?? ''
const ALERT_FROM_EMAIL       = process.env.BILLING_ALERT_FROM_EMAIL    ?? 'alerts@craudiovizai.com'

// Alert thresholds
const FALLBACK_ALERT_THRESHOLD  = 3    // consecutive billing-unavailable events
const PRECHECK_BLOCK_THRESHOLD  = 10   // precheck blocks within window
const ANOMALY_COST_THRESHOLD    = 20   // single deduction above this = anomaly
const ALERT_WINDOW_MINUTES      = 5    // sliding window for spike detection
const MAX_STORED_EVENTS         = 100  // ring buffer — oldest trimmed beyond this

export type MonitorEventType =
  | 'BILLING_UNAVAILABLE_FALLBACK'
  | 'PRECHECK_BLOCKED'
  | 'CREDITS_USED_HIGH'

export interface MonitorEvent {
  type:       MonitorEventType
  route?:     string
  userId?:    string   // partial ID only — 8 chars max
  cost?:      number
  reason?:    string
  fallback?:  boolean
  metadata?:  Record<string, unknown>
  timestamp:  string
}

// ── Supabase client (lazy) ────────────────────────────────────────────────────
let _db: ReturnType<typeof createClient> | null = null
function db() {
  if (!_db) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!url || !key) throw new Error('[billing/monitor] Supabase not configured')
    _db = createClient(url, key)
  }
  return _db
}

// ── Primary entry point — call from credits.ts on each billable event ─────────
/**
 * ingestBillingEvent — store event and evaluate alert conditions.
 * Fire-and-forget safe: never throws, catches all errors internally.
 */
export async function ingestBillingEvent(event: MonitorEvent): Promise<void> {
  try {
    await storeEvent(event)
    await evaluateAlerts(event)
  } catch (err) {
    // Monitor must NEVER cause billing routes to fail
    console.error('[billing/monitor] ingest error (non-fatal):', err)
  }
}

// ── Store event in Supabase, trim to MAX_STORED_EVENTS ───────────────────────
async function storeEvent(event: MonitorEvent): Promise<void> {
  const supabase = db()

  // Insert new event
  await supabase.from('billing_monitor_events').insert({
    event_type:  event.type,
    route:       event.route       ?? null,
    user_id:     event.userId      ?? null,
    cost:        event.cost        ?? null,
    reason:      event.reason      ?? null,
    fallback:    event.fallback    ?? null,
    metadata:    event.metadata    ?? {},
    created_at:  event.timestamp,
  })

  // Trim to 100 events — keep newest, delete oldest beyond the cap
  // Uses a subquery: delete rows whose id is NOT in the top 100 by created_at
  const { data: oldest } = await supabase
    .from('billing_monitor_events')
    .select('id')
    .order('created_at', { ascending: true })
    .limit(1000)

  if (oldest && oldest.length > MAX_STORED_EVENTS) {
    const toDelete = oldest
      .slice(0, oldest.length - MAX_STORED_EVENTS)
      .map((r: { id: string }) => r.id)

    await supabase
      .from('billing_monitor_events')
      .delete()
      .in('id', toDelete)
  }
}

// ── Alert condition evaluation ────────────────────────────────────────────────
async function evaluateAlerts(event: MonitorEvent): Promise<void> {
  const supabase    = db()
  const windowStart = new Date(Date.now() - ALERT_WINDOW_MINUTES * 60 * 1000).toISOString()

  // ── Condition 1: any high-cost single deduction ───────────────────────────
  if (event.type === 'CREDITS_USED_HIGH') {
    await fireAlert({
      level:   'critical',
      subject: `⚠️ High credit deduction: ${event.cost} credits on ${event.route}`,
      body:    `A single credit deduction of **${event.cost} credits** was recorded on route \`${event.route}\`.\n\nThreshold: ${ANOMALY_COST_THRESHOLD} credits.\nUser: ${event.userId ?? 'unknown'}\nTimestamp: ${event.timestamp}`,
      event,
    })
    return
  }

  // ── Condition 2: billing unavailable spike ────────────────────────────────
  if (event.type === 'BILLING_UNAVAILABLE_FALLBACK') {
    const { count } = await supabase
      .from('billing_monitor_events')
      .select('id', { count: 'exact', head: true })
      .eq('event_type', 'BILLING_UNAVAILABLE_FALLBACK')
      .gte('created_at', windowStart)

    const total = count ?? 0
    // Alert at threshold, then every threshold interval (avoid spam)
    if (total >= FALLBACK_ALERT_THRESHOLD && total % FALLBACK_ALERT_THRESHOLD === 0) {
      await fireAlert({
        level:   'critical',
        subject: `🔴 Billing service unreachable — ${total} events in ${ALERT_WINDOW_MINUTES}m`,
        body:    `The billing service has been unreachable **${total} times** in the last ${ALERT_WINDOW_MINUTES} minutes.\n\nFallback mode is active: team/reasoning/image routes are BLOCKED.\nChat and forge (cheap/standard) continue on fallback budget.\n\nLast event timestamp: ${event.timestamp}\nCheck: ${BILLING_BASE}/api/billing/usage`,
        event,
      })
    }
    return
  }

  // ── Condition 3: precheck block spike ────────────────────────────────────
  if (event.type === 'PRECHECK_BLOCKED') {
    const { count } = await supabase
      .from('billing_monitor_events')
      .select('id', { count: 'exact', head: true })
      .eq('event_type', 'PRECHECK_BLOCKED')
      .gte('created_at', windowStart)

    const total = count ?? 0
    if (total >= PRECHECK_BLOCK_THRESHOLD && total % PRECHECK_BLOCK_THRESHOLD === 0) {
      await fireAlert({
        level:   'warning',
        subject: `🟡 Credit block spike — ${total} blocked requests in ${ALERT_WINDOW_MINUTES}m`,
        body:    `**${total} users** have been blocked by enforcePrecheck in the last ${ALERT_WINDOW_MINUTES} minutes.\n\nThis may indicate:\n- A credit allocation issue (users running out unexpectedly)\n- A pricing misconfiguration\n- Legitimate high usage\n\nLast blocked route: ${event.route ?? 'unknown'}\nLast reason: ${event.reason ?? 'unknown'}\nTimestamp: ${event.timestamp}`,
        event,
      })
    }
  }
}

// ── Alert delivery: webhook + email ──────────────────────────────────────────
interface AlertPayload {
  level:   'critical' | 'warning' | 'info'
  subject: string
  body:    string
  event:   MonitorEvent
}

async function fireAlert(payload: AlertPayload): Promise<void> {
  const { level, subject, body, event } = payload

  console.log(`BILLING_ALERT_FIRED`, {
    level,
    subject,
    event_type: event.type,
    timestamp:  event.timestamp,
  })

  // ── Record alert in Supabase ──────────────────────────────────────────────
  try {
    await db().from('billing_alerts').insert({
      level,
      subject,
      body,
      event_type:   event.type,
      trigger_data: event,
      created_at:   new Date().toISOString(),
    })
  } catch (err) {
    console.error('[billing/monitor] failed to store alert:', err)
  }

  // ── Discord / generic webhook ─────────────────────────────────────────────
  if (ALERT_WEBHOOK_URL) {
    try {
      const color = level === 'critical' ? 0xFF0000 : level === 'warning' ? 0xFFA500 : 0x0099FF
      await fetch(ALERT_WEBHOOK_URL, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          embeds: [{
            title:       subject,
            description: body.slice(0, 2000),
            color,
            footer:      { text: `javari-ai billing monitor • ${event.timestamp}` },
          }],
        }),
        signal: AbortSignal.timeout(5000),
      })
    } catch (err) {
      console.error('[billing/monitor] webhook delivery failed:', err)
    }
  }

  // ── Resend email ──────────────────────────────────────────────────────────
  if (RESEND_API_KEY && ALERT_EMAIL) {
    try {
      await fetch('https://api.resend.com/emails', {
        method:  'POST',
        headers: {
          'Authorization': `Bearer ${RESEND_API_KEY}`,
          'Content-Type':  'application/json',
        },
        body: JSON.stringify({
          from:    ALERT_FROM_EMAIL,
          to:      [ALERT_EMAIL],
          subject,
          text:    body,
          html:    `<pre style="font-family:monospace;white-space:pre-wrap">${body}</pre>`,
        }),
        signal: AbortSignal.timeout(5000),
      })
    } catch (err) {
      console.error('[billing/monitor] email delivery failed:', err)
    }
  }
}
