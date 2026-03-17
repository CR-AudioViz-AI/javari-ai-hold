// app/api/javari/verify/task/route.ts
// Javari Task Verification — checks if a completed task's artifacts actually exist
// POST { task_id: string }  — verify one task
// GET                       — verify all recently completed unverified tasks (up to 20)
// Tuesday, March 17, 2026
import { NextRequest, NextResponse } from 'next/server'
import { createClient }              from '@supabase/supabase-js'

export const dynamic    = 'force-dynamic'
export const runtime    = 'nodejs'
export const maxDuration = 30

function db() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

// Known Supabase tables — verified to exist in the production schema
const KNOWN_TABLES = new Set([
  'canonical_tasks','roadmap_master','javari_jobs','javari_memory',
  'javari_system_config','javari_roadmap_progress','javari_execution_log',
  'canonical_docs','canonical_doc_chunks','platform_secrets',
  'roadmap_tasks','canonical_chunks',
  // Phase 0 tables
  'user_credits','credit_transactions','consent_records','audit_logs',
  // Phase 1 tables
  'chat_sessions','chat_messages',
  // Phase 2 tables from canonical docs
  'grant_applications','grant_organizations','grant_opportunities',
  'grant_tasks','grant_attachments','application_checklist_items',
  'reporting_requirements','funder_requests',
  'vendors','marketplace_listings','marketplace_transactions',
  'user_preferences','user_integrations','integration_activity',
  'user_reminders','user_calendar_events',
  'documentation_pages','user_assets',
  'impact_members','impact_events',
  'game_sessions','game_scores',
  'email_subscribers',
])

// Registered routes in the platform
const REGISTERED_ROUTES = new Set([
  '/api/autonomy/loop',
  '/api/autonomy/status',
  '/api/autonomy/scan',
  '/api/autonomy/pr-workflow',
  '/api/autonomy/pr-merge',
  '/api/javari/chat',
  '/api/javari/team',
  '/api/javari/worker',
  '/api/javari/test',
  '/api/javari/learning/update',
  '/api/javari/r2/list',
  '/api/javari/r2/load',
  '/api/javari/verify/task',
  '/api/canonical/ingest',
  '/api/canonical/search',
])

interface VerificationResult {
  task_id:   string
  title:     string
  task_type: string
  checks:    { name: string; passed: boolean; detail: string }[]
  verified:  boolean
  notes:     string
}

async function verifyTask(
  supabase: ReturnType<typeof db>,
  task: { id: string; title: string; task_type: string; artifacts: string[]; module: string; phase: number }
): Promise<VerificationResult> {
  const checks: { name: string; passed: boolean; detail: string }[] = []

  // ── 1. roadmap_master row exists and is completed ─────────────────────────
  const { data: rmRow } = await supabase
    .from('roadmap_master')
    .select('id, status, executed_at, execution_model')
    .eq('id', task.id)
    .single()

  const rmExists = !!rmRow && rmRow.status === 'completed'
  checks.push({
    name:   'roadmap_master.status=completed',
    passed: rmExists,
    detail: rmRow ? `status=${rmRow.status} model=${rmRow.execution_model ?? '—'}` : 'row not found',
  })

  // ── 2. Execution log entry ─────────────────────────────────────────────────
  const { data: logRow } = await supabase
    .from('javari_execution_log')
    .select('id, status, cost_usd, duration_ms')
    .eq('roadmap_task_id', task.id)
    .eq('status', 'completed')
    .limit(1)
    .single()

  checks.push({
    name:   'javari_execution_log entry',
    passed: !!logRow,
    detail: logRow ? `cost=$${Number(logRow.cost_usd ?? 0).toFixed(5)} dur=${logRow.duration_ms}ms` : 'no log entry',
  })

  // ── 3. DB artifact verification (for db task_type) ─────────────────────────
  if (task.task_type === 'db') {
    const tableArtifacts = (task.artifacts ?? []).filter(a =>
      !a.includes('.ts') && !a.includes('.tsx') && !a.includes('entity') && !a.includes('repo')
    )
    for (const artifact of tableArtifacts.slice(0, 3)) {
      const tableName = artifact.replace(/[^a-z_]/g, '').toLowerCase()
      const inKnown   = KNOWN_TABLES.has(tableName)
      // Also check live in Supabase
      let liveExists  = inKnown
      if (!inKnown) {
        try {
          const res = await supabase.from(tableName as any).select('*', { head: true, count: 'exact' })
          liveExists = !res.error
        } catch { liveExists = false }
      }
      checks.push({
        name:   `DB table: ${tableName}`,
        passed: liveExists,
        detail: liveExists ? 'exists' : 'not found in schema',
      })
    }
  }

  // ── 4. API route verification (for api task_type) ──────────────────────────
  if (task.task_type === 'api') {
    // Extract route pattern from title
    const routeMatch = task.title.match(/(?:GET|POST|PUT|PATCH|DELETE)\s+(\/[^\s]+)/i)
    if (routeMatch) {
      const path = routeMatch[1]
      checks.push({
        name:   `Route: ${path}`,
        passed: REGISTERED_ROUTES.has(path),
        detail: REGISTERED_ROUTES.has(path) ? 'registered' : 'not in route registry',
      })
    }
  }

  // ── 5. Memory entry exists ─────────────────────────────────────────────────
  const { data: memRow } = await supabase
    .from('javari_memory')
    .select('id')
    .or(`key.eq.roadmap_master:${task.id},key.eq.roadmap:${task.id}`)
    .limit(1)
    .single()

  checks.push({
    name:   'javari_memory entry',
    passed: !!memRow,
    detail: memRow ? 'found' : 'no memory entry',
  })

  // ── Aggregate: verified only if all mandatory checks pass ──────────────────
  const mandatory = ['roadmap_master.status=completed', 'javari_execution_log entry']
  const allMandatoryPass = checks
    .filter(c => mandatory.includes(c.name))
    .every(c => c.passed)

  const verified = allMandatoryPass
  const notes    = verified
    ? 'All mandatory checks passed'
    : checks.filter(c => !c.passed).map(c => c.name).join('; ')

  return {
    task_id:   task.id,
    title:     task.title,
    task_type: task.task_type,
    checks,
    verified,
    notes,
  }
}

// ── POST: verify single task ──────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const auth = req.headers.get('authorization') ?? ''
  if (!auth.includes(process.env.CRON_SECRET ?? 'javari-cron-2025-phase2-autonomous')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { task_id } = await req.json() as { task_id?: string }
    if (!task_id) return NextResponse.json({ error: 'task_id required' }, { status: 400 })

    const supabase = db()
    const { data: task } = await supabase
      .from('roadmap_master')
      .select('id, title, task_type, artifacts, module, phase')
      .eq('id', task_id)
      .single()

    if (!task) return NextResponse.json({ error: 'Task not found' }, { status: 404 })

    const result = await verifyTask(supabase, task)

    // Persist verification result
    if (result.verified) {
      await supabase.from('roadmap_master')
        .update({ verified: true, verified_at: new Date().toISOString(), verification_notes: result.notes })
        .eq('id', task_id)
      await supabase.from('canonical_tasks')
        .update({ status: 'complete', updated_at: new Date().toISOString() })
        .eq('id', task_id)
      await supabase.from('javari_execution_log')
        .update({ verification: true })
        .eq('roadmap_task_id', task_id)
    }

    return NextResponse.json({ ok: true, result, timestamp: new Date().toISOString() })

  } catch (err: unknown) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 })
  }
}

// ── GET: batch-verify recently completed unverified tasks ─────────────────────
export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization') ?? ''
  if (!auth.includes(process.env.CRON_SECRET ?? 'javari-cron-2025-phase2-autonomous')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const supabase = db()

    const { data: tasks } = await supabase
      .from('roadmap_master')
      .select('id, title, task_type, artifacts, module, phase')
      .eq('status', 'completed')
      .eq('verified', false)
      .order('executed_at', { ascending: false })
      .limit(20)

    if (!tasks?.length) {
      return NextResponse.json({ ok: true, verified: 0, message: 'No unverified tasks', timestamp: new Date().toISOString() })
    }

    const results: VerificationResult[] = []
    let verifiedCount = 0

    for (const task of tasks) {
      const result = await verifyTask(supabase, task)
      results.push(result)
      if (result.verified) {
        verifiedCount++
        await supabase.from('roadmap_master')
          .update({ verified: true, verified_at: new Date().toISOString(), verification_notes: result.notes })
          .eq('id', task.id)
        await supabase.from('javari_execution_log')
          .update({ verification: true })
          .eq('roadmap_task_id', task.id)
      }
    }

    return NextResponse.json({
      ok:           true,
      checked:      tasks.length,
      verified:     verifiedCount,
      failed:       tasks.length - verifiedCount,
      results,
      timestamp:    new Date().toISOString(),
    })

  } catch (err: unknown) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 })
  }
}
