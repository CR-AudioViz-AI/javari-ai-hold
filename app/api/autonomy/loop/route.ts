// app/api/autonomy/loop/route.ts
// Javari Autonomous Loop — cron trigger every 2 minutes
// Authority: ALL tasks validated against canonicalAuthority before execution.
//   BUILD: roadmap_master first, then javari_scanner, then planner (if canonical)
//   SCAN:  scanner + canonical planner
//   MAINTAIN: no-op
// Tuesday, March 17, 2026 — canonical authority + learning loop integrated
import { NextResponse }   from 'next/server'
import { createClient }   from '@supabase/supabase-js'
import { route }          from '@/lib/javari/model-router'
import { getDailySpend }  from '@/lib/javari/model-router'
import {
  filterToCanonical,
  persistRejections,
  getAuthorityStats,
  type TaskRow,
} from '@/lib/javari/canonicalAuthority'

export const dynamic    = 'force-dynamic'
export const runtime    = 'nodejs'
export const maxDuration = 60

const DAILY_BUDGET       = 1.00
const MAX_TASKS_PER_LOOP = 10

function db() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

async function getConfig(supabase: ReturnType<typeof db>): Promise<Record<string, string>> {
  const { data } = await supabase.from('javari_system_config').select('key,value')
  return Object.fromEntries((data ?? []).map((r: { key: string; value: string }) => [r.key, r.value]))
}

export async function GET() {
  const cycleStart = Date.now()
  const cycleId    = `cycle-${cycleStart}`
  const supabase   = db()
  const executed: unknown[] = []

  // Load system config
  const config      = await getConfig(supabase)
  const mode        = config['SYSTEM_MODE']     ?? 'SCAN'
  const activePhase = parseInt(config['ACTIVE_PHASE'] ?? '2', 10)
  const maxPerRun   = Math.min(
    parseInt(config['MAX_CONCURRENT_BUILDS'] ?? String(MAX_TASKS_PER_LOOP), 10),
    MAX_TASKS_PER_LOOP
  )

  // MAINTAIN mode — no execution
  if (mode === 'MAINTAIN') {
    return NextResponse.json({ status: 'maintain_mode', message: 'System in MAINTAIN mode — no execution', mode })
  }

  // Heartbeat: fire-and-forget
  supabase.from('javari_jobs').insert({
    task: 'cron_heartbeat', priority: 'low', status: 'complete',
    dry_run: false, triggered_by: 'cron_build_loop',
    metadata: { mode, active_phase: activePhase, cycle_start: cycleStart, cycle_id: cycleId },
    started_at:   new Date(cycleStart).toISOString(),
    completed_at: new Date(cycleStart).toISOString(),
    result: { heartbeat: true },
  })

  // Budget gate
  const spent = await getDailySpend()
  if (spent >= DAILY_BUDGET) {
    return NextResponse.json({
      status: 'budget_reached', daily_spend: `$${spent.toFixed(4)}`,
      limit: `$${DAILY_BUDGET}`, mode,
    })
  }

  // Source priority waterfall
  const taskSource     = mode === 'BUILD' ? 'roadmap_master' : null
  const sourcePriority = taskSource
    ? [taskSource, 'javari_scanner', 'planner']
    : ['javari_scanner', 'planner']

  // Fetch candidates — over-fetch to account for canonical rejections
  const FETCH_LIMIT = MAX_TASKS_PER_LOOP * 2  // fetch extra to compensate for rejects
  let rawBatch: TaskRow[] = []
  let fetchedSource = ''

  for (const src of sourcePriority) {
    const { data } = await supabase
      .from('roadmap_tasks')
      .select('id, title, description, phase_id, source, metadata')
      .in('status', ['pending', 'retry'])
      .eq('source', src)
      .order('id', { ascending: true })
      .limit(FETCH_LIMIT)
    if (data?.length) {
      rawBatch      = data as TaskRow[]
      fetchedSource = src
      break
    }
  }

  if (!rawBatch.length) {
    const finalSpend = await getDailySpend()
    return NextResponse.json({
      status: 'idle', mode, tasks_run: 0, executed: [],
      daily_spend:   `$${finalSpend.toFixed(4)}`,
      budget_left:   `$${Math.max(0, DAILY_BUDGET - finalSpend).toFixed(4)}`,
      cycle_ms:      Date.now() - cycleStart,
      timestamp:     new Date().toISOString(),
      authority:     getAuthorityStats(),
    })
  }

  // ── CANONICAL AUTHORITY GATE ──────────────────────────────────────────────
  // roadmap_master and javari_scanner tasks pass automatically.
  // planner tasks are validated against active phase + module registry.
  const { accepted, rejected, rejections } = filterToCanonical(rawBatch, activePhase)

  // Persist rejections as 'blocked' in Supabase (fire-and-forget)
  if (rejected.length > 0) {
    persistRejections(rejected, rejections).catch(() => {/* non-fatal */})
  }

  const batch = accepted.slice(0, maxPerRun)

  if (!batch.length) {
    const finalSpend = await getDailySpend()
    return NextResponse.json({
      status:      'idle',
      reason:      `all ${rawBatch.length} tasks rejected by canonical authority`,
      mode,        tasks_run: 0, executed: [],
      rejected:    rejected.length,
      daily_spend: `$${finalSpend.toFixed(4)}`,
      budget_left: `$${Math.max(0, DAILY_BUDGET - finalSpend).toFixed(4)}`,
      cycle_ms:    Date.now() - cycleStart,
      timestamp:   new Date().toISOString(),
      authority:   getAuthorityStats(),
    })
  }

  // Claim accepted batch: pending/retry → in_progress
  await supabase.from('roadmap_tasks')
    .update({ status: 'in_progress', updated_at: Date.now() })
    .in('id', batch.map(t => t.id))

  // Execute all accepted tasks concurrently
  const taskStartTime = Date.now()
  const taskPromises = batch.map(async (task) => {
    const taskStart = Date.now()
    const meta      = (task.metadata ?? {}) as Record<string, unknown>
    const taskType  = (meta.task_type as string) ?? detectType(task.title + ' ' + (task.description ?? ''))
    try {
      const prompt = [
        `Task: ${task.title}`,
        task.description ? `Description: ${task.description}` : '',
        meta.target_url ? `Target URL: ${meta.target_url}` : '',
        meta.milestone  ? `Milestone: ${meta.milestone}`   : '',
      ].filter(Boolean).join('\n')

      const result = await route(taskType as any, prompt, {
        systemPrompt: [
          'You are Javari AI, the autonomous operating system for CR AudioViz AI.',
          'Mission: "Your Story. Our Design." Owned by Roy & Cindy Henderson.',
          'Execute the task and return specific, actionable output.',
          'For deployment tasks: return the exact steps, files, and commands needed.',
          'For coding tasks: return complete, production-ready code.',
        ].join('\n'),
        maxTier: meta.priority === 'critical' ? 'moderate' : 'low',
      })

      if (result.blocked) {
        await supabase.from('roadmap_tasks')
          .update({ status: 'pending', error: result.reason, updated_at: Date.now() })
          .eq('id', task.id)
        return { learning: { task_id: task.id, task_title: task.title, task_source: task.source,
          task_type: taskType, status: 'blocked' as const, canonical_valid: true,
          phase_id: task.phase_id ?? '', cycle_id: cycleId } }
      }

      // in_progress → completed
      await supabase.from('roadmap_tasks').update({
        status:         'completed',
        assigned_model: result.model,
        completed_at:   new Date().toISOString(),
        result:         result.content.slice(0, 1000),
        cost:           result.cost,
        updated_at:     Date.now(),
      }).eq('id', task.id)

      const { data: job } = await supabase.from('javari_jobs').insert({
        task:         task.title,
        priority:     (meta.priority as string) ?? 'normal',
        status:       'complete',
        dry_run:      false,
        triggered_by: `cron_${mode.toLowerCase()}_loop`,
        metadata:     { roadmap_task_id: task.id, task_type: taskType, mode, cycle_id: cycleId },
        started_at:   new Date(cycleStart).toISOString(),
        completed_at: new Date().toISOString(),
        result:       { output: result.content.slice(0, 2000), model: result.model, cost: result.cost },
      }).select('id').single()

      const memType = ['planning','analysis'].includes(taskType) ? 'decision' : 'fact'
      await supabase.from('javari_memory').insert({
        memory_type: memType,
        key:         `roadmap:${task.id}`,
        value:       result.content.slice(0, 2000),
        source:      `${mode.toLowerCase()}_loop`,
        task_id:     job?.id ?? task.id,
        content:     result.content.slice(0, 8000),
      })

      if (meta.milestone) {
        await supabase.from('javari_roadmap_progress')
          .update({ status: 'complete', notes: `Executed by Javari AI: ${result.model}`, updated_at: new Date().toISOString() })
          .eq('item_id', meta.milestone as string)
          .eq('status', 'pending')
      }

      return {
        roadmap_task_id: task.id,
        title:    task.title,
        task_type: taskType,
        model:    result.model,
        cost:     result.cost,
        job_id:   job?.id,
        learning: {
          task_id:        task.id,
          task_title:     task.title,
          task_source:    task.source,
          task_type:      taskType,
          status:         'completed' as const,
          model:          result.model,
          cost:           result.cost,
          duration_ms:    Date.now() - taskStart,
          canonical_valid: true,
          phase_id:       task.phase_id ?? '',
          cycle_id:       cycleId,
        },
      }

    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      await supabase.from('roadmap_tasks')
        .update({ status: 'retry', error: msg, updated_at: Date.now() })
        .eq('id', task.id)
      return {
        roadmap_task_id: task.id,
        title:    task.title,
        error:    msg,
        learning: {
          task_id:        task.id,
          task_title:     task.title,
          task_source:    task.source,
          task_type:      taskType,
          status:         'failed' as const,
          error:          msg,
          duration_ms:    Date.now() - taskStart,
          canonical_valid: true,
          phase_id:       task.phase_id ?? '',
          cycle_id:       cycleId,
        },
      }
    }
  })

  const results = await Promise.allSettled(taskPromises)
  const learningRecords: unknown[] = []

  for (const r of results) {
    if (r.status === 'fulfilled' && r.value) {
      const val = r.value as Record<string, unknown>
      executed.push(val)
      if (val.learning) learningRecords.push(val.learning)
    }
  }

  // Add rejected tasks to learning records
  for (let i = 0; i < rejected.length; i++) {
    learningRecords.push({
      task_id:        rejected[i].id,
      task_title:     rejected[i].title,
      task_source:    rejected[i].source,
      task_type:      'unknown',
      status:         'rejected',
      canonical_valid: false,
      phase_id:       rejected[i].phase_id ?? '',
      cycle_id:       cycleId,
    })
  }

  // Fire-and-forget learning write
  if (learningRecords.length > 0) {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://javari-ai.vercel.app'
    fetch(`${baseUrl}/api/javari/learning/update`, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${process.env.CRON_SECRET ?? 'javari-cron-2025-phase2-autonomous'}`,
      },
      body: JSON.stringify({
        records:  learningRecords,
        cycle_ms: Date.now() - taskStartTime,
      }),
    }).catch(() => {/* non-fatal */})
  }

  const finalSpend = await getDailySpend()
  const authorityStats = getAuthorityStats()

  return NextResponse.json({
    status:      executed.length > 0 ? 'executed' : 'idle',
    mode,
    active_phase: activePhase,
    tasks_run:   executed.length,
    executed,
    rejected_by_authority: rejected.length,
    canonical_rate: batch.length > 0
      ? Math.round(100 * batch.length / rawBatch.length)
      : 0,
    daily_spend: `$${finalSpend.toFixed(4)}`,
    budget_left: `$${Math.max(0, DAILY_BUDGET - finalSpend).toFixed(4)}`,
    cycle_ms:    Date.now() - cycleStart,
    timestamp:   new Date().toISOString(),
    authority:   authorityStats,
  })
}

function detectType(text: string): string {
  const t = text.toLowerCase()
  if (/plan|design|architect|strateg|roadmap|breakdown/.test(t)) return 'planning'
  if (/code|implement|write|build|fix|debug|refactor|function|component|deploy/.test(t)) return 'coding'
  if (/verify|validate|check|review|test|audit|confirm|ensure/.test(t)) return 'verification'
  if (/analys|research|investig|examine|evaluat/.test(t)) return 'analysis'
  return 'chat'
}
