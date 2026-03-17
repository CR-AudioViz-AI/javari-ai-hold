// app/api/autonomy/loop/route.ts
// Javari Autonomous Loop — cron trigger every 2 minutes
// Respects SYSTEM_MODE from javari_system_config:
//   BUILD: pulls from roadmap_tasks WHERE source='roadmap_master' first, then any pending/retry
//   SCAN:  standard queue execution
//   MAINTAIN: no-op
// Monday, March 16, 2026 — MAX_TASKS_PER_LOOP=10, concurrent execution via Promise.allSettled
import { NextResponse }  from 'next/server'
import { createClient }  from '@supabase/supabase-js'
import { route }         from '@/lib/javari/model-router'
import { getDailySpend } from '@/lib/javari/model-router'
export const dynamic   = 'force-dynamic'
export const runtime   = 'nodejs'
export const maxDuration = 60

const DAILY_BUDGET      = 1.00
const MAX_TASKS_PER_LOOP = 10   // increased from 2 → 10 for higher throughput

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
  const supabase   = db()
  const executed: unknown[] = []

  // Load system config
  const config    = await getConfig(supabase)
  const mode      = config['SYSTEM_MODE'] ?? 'SCAN'
  // Use MAX_TASKS_PER_LOOP constant — config override still respected but capped at 10
  const maxPerRun = Math.min(
    parseInt(config['MAX_CONCURRENT_BUILDS'] ?? String(MAX_TASKS_PER_LOOP), 10),
    MAX_TASKS_PER_LOOP
  )

  // MAINTAIN mode — no execution
  if (mode === 'MAINTAIN') {
    return NextResponse.json({ status: 'maintain_mode', message: 'System in MAINTAIN mode — no execution', mode })
  }

  // Heartbeat: write to javari_jobs on EVERY cycle
  supabase.from('javari_jobs').insert({
    task: 'cron_heartbeat', priority: 'low', status: 'complete',
    dry_run: false, triggered_by: 'cron_build_loop',
    metadata: { mode, cycle_start: cycleStart },
    started_at: new Date(cycleStart).toISOString(),
    completed_at: new Date(cycleStart).toISOString(),
    result: { heartbeat: true, note: 'written every cron cycle regardless of tasks' },
  }) // fire-and-forget

  // Budget gate
  const spent = await getDailySpend()
  if (spent >= DAILY_BUDGET) {
    return NextResponse.json({
      status: 'budget_reached', daily_spend: `$${spent.toFixed(4)}`,
      limit: `$${DAILY_BUDGET}`, mode,
    })
  }

  // BUILD mode: prioritise roadmap_master tasks
  const taskSource = mode === 'BUILD' ? 'roadmap_master' : null

  // Source priority waterfall: roadmap_master → javari_scanner → planner
  const sourcePriority = taskSource
    ? [taskSource, 'javari_scanner', 'planner']
    : ['javari_scanner', 'planner']

  // Fetch up to MAX_TASKS_PER_LOOP tasks in one query per source
  type TaskRow = { id: string; title: string; description: string | null; phase_id: string | null; metadata: Record<string, unknown> | null }
  let taskBatch: TaskRow[] = []

  for (const src of sourcePriority) {
    const { data } = await supabase
      .from('roadmap_tasks')
      .select('id, title, description, phase_id, metadata')
      .in('status', ['pending', 'retry'])
      .eq('source', src)
      .order('id', { ascending: true })
      .limit(MAX_TASKS_PER_LOOP)
    if (data?.length) {
      taskBatch = data as TaskRow[]
      break
    }
  }

  if (!taskBatch.length) {
    const finalSpend = await getDailySpend()
    return NextResponse.json({
      status: 'idle', mode, tasks_run: 0, executed: [],
      daily_spend: `$${finalSpend.toFixed(4)}`,
      budget_left: `$${Math.max(0, DAILY_BUDGET - finalSpend).toFixed(4)}`,
      cycle_ms: Date.now() - cycleStart,
      timestamp: new Date().toISOString(),
    })
  }

  // Claim all tasks atomically: pending/retry → in_progress
  const batch = taskBatch.slice(0, maxPerRun)
  await supabase.from('roadmap_tasks')
    .update({ status: 'in_progress', updated_at: Date.now() })
    .in('id', batch.map(t => t.id))

  // Execute all tasks concurrently — parallel AI calls, ~5s total vs 10×5s=50s sequential
  const taskPromises = batch.map(async (task) => {
    const meta     = (task.metadata ?? {}) as Record<string, unknown>
    const taskType = (meta.task_type as string) ?? detectType(task.title + ' ' + (task.description ?? ''))
    try {
      const prompt = [
        `Task: ${task.title}`,
        task.description ? `Description: ${task.description}` : '',
        meta.target_url ? `Target URL: ${meta.target_url}` : '',
        meta.milestone  ? `Milestone: ${meta.milestone}`  : '',
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
        return null
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
        metadata:     { roadmap_task_id: task.id, task_type: taskType, mode },
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

      return { roadmap_task_id: task.id, title: task.title, task_type: taskType,
               model: result.model, cost: result.cost, job_id: job?.id }

    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      // in_progress → retry on failure
      await supabase.from('roadmap_tasks')
        .update({ status: 'retry', error: msg, updated_at: Date.now() })
        .eq('id', task.id)
      return { roadmap_task_id: task.id, title: task.title, error: msg }
    }
  })

  const results = await Promise.allSettled(taskPromises)
  for (const r of results) {
    if (r.status === 'fulfilled' && r.value) executed.push(r.value)
  }

  const finalSpend = await getDailySpend()
  return NextResponse.json({
    status:      executed.length > 0 ? 'executed' : 'idle',
    mode,
    tasks_run:   executed.length,
    executed,
    daily_spend: `$${finalSpend.toFixed(4)}`,
    budget_left: `$${Math.max(0, DAILY_BUDGET - finalSpend).toFixed(4)}`,
    cycle_ms:    Date.now() - cycleStart,
    timestamp:   new Date().toISOString(),
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
