// app/api/migrate/billing/route.ts
// ONE-TIME migration endpoint — creates billing schema via direct Postgres.
// Protected by CRON_SECRET. DELETE FILE after running once.
// Thursday, March 19, 2026
import { NextRequest, NextResponse } from 'next/server'

export const dynamic    = 'force-dynamic'
export const runtime    = 'nodejs'
export const maxDuration = 30

const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS user_subscriptions (
    id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                 TEXT        NOT NULL,
    stripe_customer_id      TEXT,
    stripe_subscription_id  TEXT        UNIQUE,
    plan_tier               TEXT        NOT NULL DEFAULT 'free'
                                CHECK (plan_tier IN ('free','pro','power')),
    status                  TEXT        NOT NULL DEFAULT 'active'
                                CHECK (status IN ('active','canceled','past_due','trialing','incomplete')),
    current_period_end      TIMESTAMPTZ,
    cancel_at_period_end    BOOLEAN     NOT NULL DEFAULT false,
    trial_end               TIMESTAMPTZ,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS user_subscriptions_user_id_idx
     ON user_subscriptions (user_id)`,
  `CREATE INDEX IF NOT EXISTS user_subscriptions_stripe_customer_idx
     ON user_subscriptions (stripe_customer_id)
     WHERE stripe_customer_id IS NOT NULL`,
  `CREATE TABLE IF NOT EXISTS billing_events (
    id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id          TEXT,
    event_type       TEXT        NOT NULL,
    stripe_event_id  TEXT        UNIQUE,
    payload          JSONB       NOT NULL DEFAULT '{}',
    processed        BOOLEAN     NOT NULL DEFAULT false,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS billing_events_user_id_idx
     ON billing_events (user_id) WHERE user_id IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS billing_events_event_type_idx
     ON billing_events (event_type)`,
  `CREATE INDEX IF NOT EXISTS billing_events_created_at_idx
     ON billing_events (created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS usage_ledger (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      TEXT        NOT NULL,
    feature      TEXT        NOT NULL,
    usage_count  INTEGER     NOT NULL DEFAULT 1 CHECK (usage_count > 0),
    metadata     JSONB                DEFAULT '{}',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS usage_ledger_user_id_idx
     ON usage_ledger (user_id)`,
  `CREATE INDEX IF NOT EXISTS usage_ledger_user_feature_idx
     ON usage_ledger (user_id, feature)`,
  `CREATE INDEX IF NOT EXISTS usage_ledger_created_at_idx
     ON usage_ledger (created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS autonomy_control (
    id         INTEGER     PRIMARY KEY DEFAULT 1,
    is_paused  BOOLEAN     NOT NULL DEFAULT false,
    paused_by  TEXT,
    reason     TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT single_row CHECK (id = 1)
  )`,
  `INSERT INTO autonomy_control (id, is_paused)
   VALUES (1, false) ON CONFLICT (id) DO NOTHING`,
  `ALTER TABLE user_subscriptions ENABLE ROW LEVEL SECURITY`,
  `ALTER TABLE billing_events     ENABLE ROW LEVEL SECURITY`,
  `ALTER TABLE usage_ledger       ENABLE ROW LEVEL SECURITY`,
  `ALTER TABLE autonomy_control   ENABLE ROW LEVEL SECURITY`,
  `DO $$ BEGIN
     IF NOT EXISTS (
       SELECT 1 FROM pg_policies
       WHERE tablename = 'user_subscriptions' AND policyname = 'service_role_all_subscriptions'
     ) THEN
       CREATE POLICY service_role_all_subscriptions ON user_subscriptions
         FOR ALL USING (auth.role() = 'service_role');
     END IF;
   END $$`,
  `DO $$ BEGIN
     IF NOT EXISTS (
       SELECT 1 FROM pg_policies
       WHERE tablename = 'billing_events' AND policyname = 'service_role_all_billing_events'
     ) THEN
       CREATE POLICY service_role_all_billing_events ON billing_events
         FOR ALL USING (auth.role() = 'service_role');
     END IF;
   END $$`,
  `DO $$ BEGIN
     IF NOT EXISTS (
       SELECT 1 FROM pg_policies
       WHERE tablename = 'usage_ledger' AND policyname = 'service_role_all_usage'
     ) THEN
       CREATE POLICY service_role_all_usage ON usage_ledger
         FOR ALL USING (auth.role() = 'service_role');
     END IF;
   END $$`,
  `DO $$ BEGIN
     IF NOT EXISTS (
       SELECT 1 FROM pg_policies
       WHERE tablename = 'autonomy_control' AND policyname = 'service_role_autonomy_control'
     ) THEN
       CREATE POLICY service_role_autonomy_control ON autonomy_control
         FOR ALL USING (auth.role() = 'service_role');
     END IF;
   END $$`,
]

const VERIFY = `
  SELECT
    (SELECT COUNT(*)::int FROM information_schema.tables
     WHERE table_schema='public'
     AND table_name IN ('user_subscriptions','billing_events','usage_ledger','autonomy_control')
    ) AS tables_created,
    (SELECT COUNT(*)::int FROM pg_indexes
     WHERE schemaname='public'
     AND tablename IN ('user_subscriptions','billing_events','usage_ledger')
    ) AS indexes_created,
    (SELECT is_paused FROM autonomy_control WHERE id=1) AS kill_switch_seeded
`

export async function GET(req: NextRequest) {
  const secret = req.headers.get('x-migration-secret')
    ?? req.nextUrl.searchParams.get('secret')
  if (secret !== (process.env.CRON_SECRET ?? 'javari-cron-2025-phase2-autonomous')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Dynamic import to avoid build-time issues
  const { default: postgres } = await import('postgres')
  const sql = postgres(process.env.DATABASE_URL!, { ssl: 'require', max: 1 })

  const results: { stmt: string; ok: boolean; error?: string }[] = []

  for (const stmt of STATEMENTS) {
    const label = stmt.trim().replace(/\s+/g, ' ').slice(0, 70)
    try {
      await sql.unsafe(stmt)
      results.push({ stmt: label, ok: true })
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      // "already exists" errors are OK for idempotency
      if (msg.includes('already exists')) {
        results.push({ stmt: label, ok: true })
      } else {
        results.push({ stmt: label, ok: false, error: msg })
      }
    }
  }

  // Run verification query
  let verify: Record<string, unknown> = {}
  try {
    const [row] = await sql.unsafe(VERIFY)
    verify = row
  } catch (e: unknown) {
    verify = { error: String(e) }
  }

  await sql.end()

  const passed = results.filter(r => r.ok).length
  const failed = results.filter(r => !r.ok)

  return NextResponse.json({
    passed,
    failed_count: failed.length,
    failed_details: failed,
    verification: verify,
    results,
    timestamp: new Date().toISOString(),
  })
}
