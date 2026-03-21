-- supabase/migrations/20260321_billing_monitor_tables.sql
-- Billing monitor tables — run once in Supabase SQL editor.
-- March 21, 2026

-- ── billing_monitor_events ────────────────────────────────────────────────────
-- Ring buffer of last 100 billing events. Trimmed by lib/billing/monitor.ts.
create table if not exists billing_monitor_events (
  id          uuid        default gen_random_uuid() primary key,
  event_type  text        not null,  -- BILLING_UNAVAILABLE_FALLBACK | PRECHECK_BLOCKED | CREDITS_USED_HIGH
  route       text,
  user_id     text,                  -- partial (8 chars) — never full UUID
  cost        integer,
  reason      text,
  fallback    boolean,
  metadata    jsonb       default '{}',
  created_at  timestamptz default now() not null
);

-- Index for fast windowed queries in evaluateAlerts()
create index if not exists idx_bme_type_created
  on billing_monitor_events (event_type, created_at desc);

-- ── billing_alerts ────────────────────────────────────────────────────────────
-- Record of every alert that fired. Kept indefinitely for audit trail.
create table if not exists billing_alerts (
  id           uuid        default gen_random_uuid() primary key,
  level        text        not null,  -- critical | warning | info
  subject      text        not null,
  body         text,
  event_type   text,
  trigger_data jsonb       default '{}',
  created_at   timestamptz default now() not null
);

create index if not exists idx_ba_created
  on billing_alerts (created_at desc);

-- RLS: owner-only read access
alter table billing_monitor_events enable row level security;
alter table billing_alerts         enable row level security;

-- Service role bypasses RLS automatically — no policy needed for server-side ops.
-- Restrict anon/authenticated access:
create policy "No public read on billing_monitor_events"
  on billing_monitor_events for select
  using (false);

create policy "No public read on billing_alerts"
  on billing_alerts for select
  using (false);
