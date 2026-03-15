// app/api/autonomy/loop/route.ts
// Javari Autonomous Loop — cron trigger every 2 minutes
// Respects SYSTEM_MODE from javari_system_config:
//   BUILD: pulls from roadmap_tasks WHERE source='roadmap_master' first, then any pending
//   SCAN:  standard queue execution
//   MAINTAIN: no-op
// Concurrent build limit: MAX_CONCURRENT_BUILDS config key
// Saturday, March 14, 2026
import { NextResponse }  from 'next/server'
import { createClient }  from '@supabase/supabase-js'
import { route }         from '@/lib/javari/model-router'
import { getDailySpend } from '@/lib/javari/model-router'
export const dynamic   = 'force-dynamic'
export const runtime   = 'nodejs'
export const maxDuration = 60

const DAILY_BUDGET  = 1.00
const DEFAULT_MAX   = 3

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
  const maxPerRun = parseInt(config['MAX_CONCURRENT_BUILDS'] ?? '3', 10)

  // MAINTAIN mode — no execution
  if (mode === 'MAINTAIN') {
    return NextResponse.json({ status: 'maintain_mode', message: 'System in MAINTAIN mode — no execution', mode })
  }


  // Heartbeat: write to javari_jobs on EVERY cycle so Vercel cron execution is provable
  supabase.from('javari_jobs').insert({
    task: 'cron_heartbeat', priority: 'low', status: 'complete',
    dry_run: false, triggered_by: 'cron_build_loop',
    metadata: { mode, cycle_start: cycleStart },
    started_at: new Date(cycleStart).toISOString(),
    completed_at: new Date(cycleStart).toISOString(),
    result: { heartbeat: true, note: 'written every cron cycle regardless of tasks' },
  }) // fire-and-forget — proves cron fired even when loop returns idle
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

  for (let i = 0; i < maxPerRun; i++) {
    const currentSpend = await getDailySpend()
    if (currentSpend >= DAILY_BUDGET) break

    // Fetch next task — BUILD mode prioritises roadmap_master source
    let taskQuery = supabase
      .from('roadmap_tasks')
      .select('id, title, description, phase_id, metadata')
      .eq('status', 'pending')
      .order('id', { ascending: true })
      .limit(1)

    if (taskSource) {
      taskQuery = taskQuery.eq('source', taskSource)
    }

    const { data: tasks } = await taskQuery
    if (!tasks?.length) {
      // If BUILD mode and no roadmap_master tasks, try any pending
      if (mode === 'BUILD') break
      break
    }

    const task     = tasks[0]
    const meta     = (task.metadata ?? {}) as Record<string, unknown>
    const taskType = (meta.task_type as string) ?? detectType(task.title + ' ' + (task.description ?? ''))

    await supabase.from('roadmap_tasks')
      .update({ status: 'running', updated_at: Date.now() })
      .eq('id', task.id)

    let taskResult: unknown = null
    try {
      const prompt = [
        `Task: ${task.title}`,
        task.description ? `Description: ${task.description}` : '',
        meta.target_url ? `Target URL: ${meta.target_url}` : '',
        meta.milestone ? `Milestone: ${meta.milestone}` : '',
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
        break
      }

      await supabase.from('roadmap_tasks').update({
        status:         'completed',
        assigned_model: result.model,
        completed_at:   new Date().toISOString(),
        result:         result.content.slice(0, 1000),
        cost:           result.cost,
        updated_at:     Date.now(),
      }).eq('id', task.id)

      // Write job
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

      // Write memory
      const memType = ['planning','analysis'].includes(taskType) ? 'decision' : 'fact'
      await supabase.from('javari_memory').insert({
        memory_type: memType,
        key:         `roadmap:${task.id}`,
        value:       result.content.slice(0, 2000),
        source:      `${mode.toLowerCase()}_loop`,
        task_id:     job?.id ?? task.id,
        content:     result.content.slice(0, 8000),
      })

      // Update javari_roadmap_progress if milestone matches
      if (meta.milestone) {
        await supabase.from('javari_roadmap_progress')
          .update({ status: 'complete', notes: `Executed by Javari AI: ${result.model}`, updated_at: new Date().toISOString() })
          .eq('item_id', meta.milestone as string)
          .eq('status', 'pending')
      }

      taskResult = { roadmap_task_id: task.id, title: task.title, task_type: taskType,
                     model: result.model, cost: result.cost, job_id: job?.id }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      await supabase.from('roadmap_tasks')
        .update({ status: 'pending', error: msg, updated_at: Date.now() })
        .eq('id', task.id)
      taskResult = { roadmap_task_id: task.id, title: task.title, error: msg }
    }

    if (taskResult) executed.push(taskResult)
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
