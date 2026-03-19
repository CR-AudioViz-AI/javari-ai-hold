// app/api/migrate/billing/route.ts
// ONE-TIME billing schema migration. Protected by CRON_SECRET.
// DELETE after confirmed success.
// Thursday, March 19, 2026
import { NextRequest, NextResponse } from 'next/server'

export const dynamic    = 'force-dynamic'
export const runtime    = 'nodejs'
export const maxDuration = 30

const STMTS: string[] = [
  `CREATE TABLE IF NOT EXISTS user_subscriptions (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id TEXT NOT NULL, stripe_customer_id TEXT, stripe_subscription_id TEXT UNIQUE, plan_tier TEXT NOT NULL DEFAULT 'free' CHECK (plan_tier IN ('free','pro','power')), status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','canceled','past_due','trialing','incomplete')), current_period_end TIMESTAMPTZ, cancel_at_period_end BOOLEAN NOT NULL DEFAULT false, trial_end TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`,
  `CREATE UNIQUE INDEX IF NOT EXISTS user_subscriptions_user_id_idx ON user_subscriptions (user_id)`,
  `CREATE INDEX IF NOT EXISTS user_subscriptions_stripe_cust_idx ON user_subscriptions (stripe_customer_id) WHERE stripe_customer_id IS NOT NULL`,
  `CREATE TABLE IF NOT EXISTS billing_events (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id TEXT, event_type TEXT NOT NULL, stripe_event_id TEXT UNIQUE, payload JSONB NOT NULL DEFAULT '{}', processed BOOLEAN NOT NULL DEFAULT false, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`,
  `CREATE INDEX IF NOT EXISTS billing_events_user_idx ON billing_events (user_id) WHERE user_id IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS billing_events_type_idx ON billing_events (event_type)`,
  `CREATE INDEX IF NOT EXISTS billing_events_ts_idx ON billing_events (created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS usage_ledger (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id TEXT NOT NULL, feature TEXT NOT NULL, usage_count INTEGER NOT NULL DEFAULT 1 CHECK (usage_count > 0), metadata JSONB DEFAULT '{}', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`,
  `CREATE INDEX IF NOT EXISTS usage_ledger_uid_idx ON usage_ledger (user_id)`,
  `CREATE INDEX IF NOT EXISTS usage_ledger_feat_idx ON usage_ledger (user_id, feature)`,
  `CREATE INDEX IF NOT EXISTS usage_ledger_ts_idx ON usage_ledger (created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS autonomy_control (id INTEGER PRIMARY KEY DEFAULT 1, is_paused BOOLEAN NOT NULL DEFAULT false, paused_by TEXT, reason TEXT, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), CONSTRAINT single_row CHECK (id = 1))`,
  `INSERT INTO autonomy_control (id, is_paused) VALUES (1, false) ON CONFLICT (id) DO NOTHING`,
  `ALTER TABLE user_subscriptions ENABLE ROW LEVEL SECURITY`,
  `ALTER TABLE billing_events ENABLE ROW LEVEL SECURITY`,
  `ALTER TABLE usage_ledger ENABLE ROW LEVEL SECURITY`,
  `ALTER TABLE autonomy_control ENABLE ROW LEVEL SECURITY`,
]

const VERIFY = `SELECT (SELECT COUNT(*)::int FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('user_subscriptions','billing_events','usage_ledger','autonomy_control')) AS tables_created, (SELECT COUNT(*)::int FROM pg_indexes WHERE schemaname='public' AND tablename IN ('user_subscriptions','billing_events','usage_ledger')) AS indexes_created`

export async function GET(req: NextRequest) {
  try {
    const s = req.headers.get('x-migration-secret') ?? req.nextUrl.searchParams.get('secret')
    if (s !== (process.env.CRON_SECRET ?? 'javari-cron-2025-phase2-autonomous')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Use pg with connection string built from Supabase components
    const { Pool } = await import('pg')
    const connStr = process.env.DATABASE_URL
    if (!connStr) {
      return NextResponse.json({ error: 'DATABASE_URL not set', env_keys: Object.keys(process.env).filter(k => k.includes('SUPA') || k.includes('DB') || k.includes('PG') || k.includes('DATA')) }, { status: 500 })
    }

    // Log first 20 chars of the URL to confirm it looks like a real pg URL
    const connPreview = connStr.slice(0, 20)

    const pool   = new Pool({ connectionString: connStr, ssl: { rejectUnauthorized: false }, max: 1, connectionTimeoutMillis: 10000 })
    const client = await pool.connect()
    const results: { stmt: string; ok: boolean; error?: string }[] = []

    try {
      for (const stmt of STMTS) {
        const label = stmt.trim().slice(0, 60)
        try {
          await client.query(stmt)
          results.push({ stmt: label, ok: true })
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e)
          results.push(msg.includes('already exists') ? { stmt: label, ok: true } : { stmt: label, ok: false, error: msg })
        }
      }
      const { rows: [v] } = await client.query(VERIFY)
      const failed = results.filter(r => !r.ok)
      return NextResponse.json({ ok: true, passed: results.filter(r => r.ok).length, failed_count: failed.length, failed_details: failed, verification: v, conn_preview: connPreview, timestamp: new Date().toISOString() })
    } finally {
      client.release()
      await pool.end()
    }

  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    const stack = e instanceof Error ? e.stack?.slice(0, 300) : ''
    return NextResponse.json({ ok: false, error: msg, stack, timestamp: new Date().toISOString() }, { status: 500 })
  }
}
