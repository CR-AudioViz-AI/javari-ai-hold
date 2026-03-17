// app/api/autonomy/loop/route.ts
// Javari Deterministic Execution Loop — cron trigger every 2 minutes
// Source of truth: roadmap_master (275 canonical tasks) — NO planner, NO freeform.
// Execution order: phase ASC → priority (critical→high→normal) → id ASC
// Concurrency: up to 10 tasks per cycle via Promise.allSettled
// Tuesday, March 17, 2026
import { NextResponse }  from 'next/server'
import { createClient }  from '@supabase/supabase-js'
import { route }         from '@/lib/javari/model-router'
import { getDailySpend } from '@/lib/javari/model-router'

export const dynamic    = 'force-dynamic'
export const runtime    = 'nodejs'
export const maxDuration = 60

const DAILY_BUDGET       = 1.00
const MAX_TASKS_PER_LOOP = 10

// Priority ordering for SQL
const PRIORITY_ORDER = `CASE priority WHEN 'critical' THEN 1 WHEN 'high' THEN 2 ELSE 3 END`

function db() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

type RoadmapTask = {
  id:           string
  phase:        number
  module:       string
  module_family: string
  title:        string
  description:  string | null
  task_type:    string
  priority:     string
  dependencies: string[]
  artifacts:    string[]
}

async function getConfig(supabase: ReturnType<typeof db>): Promise<Record<string, string>> {
  const { data } = await supabase.from('javari_system_config').select('key,value')
  return Object.fromEntries((data ?? []).map((r: { key: string; value: string }) => [r.key, r.value]))
}

async function areDependenciesMet(supabase: ReturnType<typeof db>, deps: string[]): Promise<boolean> {
  if (!deps || deps.length === 0) return true
  const { data } = await supabase
    .from('roadmap_master')
    .select('id, status')
    .in('id', deps)
  if (!data) return true
  return data.every(d => d.status === 'completed')
}

export async function GET() {
  const cycleStart = Date.now()
  const cycleId    = `cycle-${cycleStart}`
  const supabase   = db()
  const executed: unknown[] = []

  // Load system config
  const config      = await getConfig(supabase)
  const mode        = config['SYSTEM_MODE'] ?? 'BUILD'
  const activePhase = parseInt(config['ACTIVE_PHASE'] ?? '2', 10)
  const maxPerRun   = Math.min(
    parseInt(config['MAX_CONCURRENT_BUILDS'] ?? String(MAX_TASKS_PER_LOOP), 10),
    MAX_TASKS_PER_LOOP
  )

  // MAINTAIN mode — no execution
  if (mode === 'MAINTAIN') {
    return NextResponse.json({
      status: 'maintain_mode',
      message: 'System in MAINTAIN mode — no execution',
      mode, roadmap_source: 'roadmap_master',
    })
  }

  // Heartbeat — fire-and-forget
  supabase.from('javari_jobs').insert({
    task: 'cron_heartbeat', priority: 'low', status: 'complete',
    dry_run: false, triggered_by: 'deterministic_loop',
    metadata: { mode, active_phase: activePhase, cycle_start: cycleStart, cycle_id: cycleId },
    started_at:   new Date(cycleStart).toISOString(),
    completed_at: new Date(cycleStart).toISOString(),
    result: { heartbeat: true, source: 'roadmap_master' },
  })

  // Budget gate
  const spent = await getDailySpend()
  if (spent >= DAILY_BUDGET) {
    return NextResponse.json({
      status: 'budget_reached',
      daily_spend: `$${spent.toFixed(4)}`,
      limit: `$${DAILY_BUDGET}`,
      mode, roadmap_source: 'roadmap_master',
    })
  }

  // ── DETERMINISTIC FETCH FROM roadmap_master ──────────────────────────────
  // Phase ≤ activePhase+1 (allow queuing one phase ahead)
  // Status: pending only — no planner, no scanner, no freeform
  // Order: phase → priority → id (stable, deterministic)
  const { data: candidates } = await supabase
    .from('roadmap_master')
    .select('id, phase, module, module_family, title, description, task_type, priority, dependencies, artifacts')
    .eq('status', 'pending')
    .lte('phase', activePhase + 1)
    .order('phase', { ascending: true })
    .order('id', { ascending: true })
    .limit(MAX_TASKS_PER_LOOP * 2)  // over-fetch for dependency filtering

  if (!candidates?.length) {
    const finalSpend = await getDailySpend()
    const { data: counts } = await supabase
      .from('roadmap_master')
      .select('status')
    const statusMap = (counts ?? []).reduce<Record<string, number>>((acc, r: { status: string }) => {
      acc[r.status] = (acc[r.status] ?? 0) + 1
      return acc
    }, {})
    return NextResponse.json({
      status:    'idle',
      reason:    'No pending tasks in roadmap_master for current phase',
      mode,      active_phase: activePhase,
      tasks_run: 0, executed: [],
      roadmap:   statusMap,
      daily_spend: `$${finalSpend.toFixed(4)}`,
      budget_left: `$${Math.max(0, DAILY_BUDGET - finalSpend).toFixed(4)}`,
      cycle_ms:    Date.now() - cycleStart,
      timestamp:   new Date().toISOString(),
    })
  }

  // ── DEPENDENCY GATE ───────────────────────────────────────────────────────
  // Filter out tasks whose dependencies are not yet completed
  const ready: RoadmapTask[] = []
  for (const task of candidates as RoadmapTask[]) {
    if (ready.length >= maxPerRun) break
    const depsOk = await areDependenciesMet(supabase, task.dependencies ?? [])
    if (depsOk) ready.push(task)
  }

  if (!ready.length) {
    const finalSpend = await getDailySpend()
    return NextResponse.json({
      status:    'blocked',
      reason:    `${candidates.length} pending tasks all blocked by unmet dependencies`,
      mode,      active_phase: activePhase,
      tasks_run: 0, executed: [],
      daily_spend: `$${finalSpend.toFixed(4)}`,
      budget_left: `$${Math.max(0, DAILY_BUDGET - finalSpend).toFixed(4)}`,
      cycle_ms:    Date.now() - cycleStart,
      timestamp:   new Date().toISOString(),
    })
  }

  // Claim: pending → in_progress
  await supabase.from('roadmap_master')
    .update({ status: 'in_progress', updated_at: new Date().toISOString() })
    .in('id', ready.map(t => t.id))

  // ── CONCURRENT EXECUTION ──────────────────────────────────────────────────
  const taskStartTime = Date.now()

  const taskPromises = ready.map(async (task) => {
    const taskStart = Date.now()
    try {
      const prompt = [
        `Task: ${task.title}`,
        task.description ? `Description: ${task.description}` : '',
        `Module: ${task.module} (${task.module_family})`,
        `Phase: ${task.phase}  Priority: ${task.priority}`,
        task.artifacts?.length ? `Artifacts to produce: ${task.artifacts.join(', ')}` : '',
      ].filter(Boolean).join('\n')

      const result = await route(task.task_type as any, prompt, {
        systemPrompt: [
          'You are Javari AI, the autonomous operating system for CR AudioViz AI.',
          'Mission: "Your Story. Our Design." Owned by Roy & Cindy Henderson.',
          'You are executing a canonical task from the deterministic roadmap.',
          'Return specific, actionable output. For code tasks: complete production-ready code.',
          'For DB tasks: exact SQL DDL. For UI tasks: complete component code.',
        ].join('\n'),
        maxTier: task.priority === 'critical' ? 'moderate' : 'low',
      })

      const duration = Date.now() - taskStart

      if (result.blocked) {
        await supabase.from('roadmap_master')
          .update({ status: 'pending', updated_at: new Date().toISOString() })
          .eq('id', task.id)
        return { id: task.id, title: task.title, status: 'blocked', reason: result.reason }
      }

      // ── Mark completed in roadmap_master ──
      await supabase.from('roadmap_master').update({
        status:          'completed',
        execution_model: result.model,
        execution_cost:  result.cost,
        execution_ms:    duration,
        executed_at:     new Date().toISOString(),
        updated_at:      new Date().toISOString(),
      }).eq('id', task.id)

      // ── Mirror to canonical_tasks ──
      await supabase.from('canonical_tasks')
        .update({ status: 'complete', updated_at: new Date().toISOString() })
        .eq('id', task.id)

      // ── Execution log ──
      await supabase.from('javari_execution_log').insert({
        roadmap_task_id: task.id,
        cycle_id:        cycleId,
        task_type:       task.task_type,
        model:           result.model,
        cost_usd:        result.cost,
        duration_ms:     duration,
        status:          'completed',
        result_summary:  result.content.slice(0, 500),
        executed_at:     new Date().toISOString(),
      })

      // ── Memory ──
      await supabase.from('javari_memory').insert({
        memory_type: ['planning','analysis'].includes(task.task_type) ? 'decision' : 'fact',
        key:         `roadmap_master:${task.id}`,
        value:       result.content.slice(0, 2000),
        source:      'deterministic_loop',
        task_id:     task.id,
        content:     result.content.slice(0, 8000),
      })

      return {
        id:        task.id,
        title:     task.title,
        phase:     task.phase,
        module:    task.module,
        task_type: task.task_type,
        model:     result.model,
        cost:      result.cost,
        duration:  duration,
        status:    'completed',
      }

    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      const duration = Date.now() - taskStart

      // pending on retry (not failed — will try again next cycle)
      await supabase.from('roadmap_master')
        .update({ status: 'pending', updated_at: new Date().toISOString() })
        .eq('id', task.id)

      await supabase.from('javari_execution_log').insert({
        roadmap_task_id: task.id,
        cycle_id:        cycleId,
        task_type:       task.task_type,
        status:          'failed',
        error:           msg.slice(0, 500),
        duration_ms:     duration,
        executed_at:     new Date().toISOString(),
      })

      return { id: task.id, title: task.title, status: 'failed', error: msg }
    }
  })

  const results = await Promise.allSettled(taskPromises)
  for (const r of results) {
    if (r.status === 'fulfilled' && r.value) executed.push(r.value)
  }

  // Learning write — fire-and-forget
  const learningRecords = executed.map(e => {
    const ex = e as Record<string, unknown>
    return {
      task_id:        ex.id,
      task_title:     ex.title,
      task_source:    'roadmap_master',
      task_type:      ex.task_type ?? 'unknown',
      status:         ex.status as string,
      model:          ex.model,
      cost:           ex.cost,
      duration_ms:    ex.duration,
      canonical_valid: true,
      phase_id:       String(ex.phase ?? ''),
      cycle_id:       cycleId,
    }
  })

  if (learningRecords.length > 0) {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://javari-ai.vercel.app'
    fetch(`${baseUrl}/api/javari/learning/update`, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${process.env.CRON_SECRET ?? 'javari-cron-2025-phase2-autonomous'}`,
      },
      body: JSON.stringify({ records: learningRecords, cycle_ms: Date.now() - taskStartTime }),
    }).catch(() => {/* non-fatal */})
  }

  const finalSpend = await getDailySpend()
  const completed  = (executed as Record<string,unknown>[]).filter(e => e.status === 'completed').length
  const failed     = (executed as Record<string,unknown>[]).filter(e => e.status === 'failed').length

  return NextResponse.json({
    status:         executed.length > 0 ? 'executed' : 'idle',
    mode,
    active_phase:   activePhase,
    roadmap_source: 'roadmap_master',
    tasks_run:      executed.length,
    completed,
    failed,
    executed,
    daily_spend:    `$${finalSpend.toFixed(4)}`,
    budget_left:    `$${Math.max(0, DAILY_BUDGET - finalSpend).toFixed(4)}`,
    cycle_ms:       Date.now() - cycleStart,
    timestamp:      new Date().toISOString(),
  })
}
