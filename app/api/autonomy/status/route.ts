// app/api/autonomy/status/route.ts
// Javari OS — Autonomy Status
// ALL data from roadmap_master (275 canonical tasks). Trusted, stable, deterministic.
// Tuesday, March 17, 2026
import { NextResponse }  from 'next/server'
import { createClient }  from '@supabase/supabase-js'
import { getDailySpend } from '@/lib/javari/model-router'

export const dynamic    = 'force-dynamic'
export const runtime    = 'nodejs'
export const maxDuration = 15

function db() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export async function GET() {
  try {
    const supabase = db()

    // Load config
    const { data: configRows } = await supabase
      .from('javari_system_config')
      .select('key,value')
    const config = Object.fromEntries(
      (configRows ?? []).map((r: { key: string; value: string }) => [r.key, r.value])
    )

    // roadmap_master — canonical task counts (TOTAL = 275 fixed)
    const { data: allTasks } = await supabase
      .from('roadmap_master')
      .select('id, phase, status, priority, module, module_family, title, executed_at, execution_model, execution_cost, verified')
      .order('phase', { ascending: true })

    const tasks = allTasks ?? []
    const TOTAL = tasks.length

    // Status breakdown
    const statusMap: Record<string, number> = {}
    for (const t of tasks) {
      statusMap[t.status] = (statusMap[t.status] ?? 0) + 1
    }

    // Phase breakdown
    const phaseMap: Record<number, { total: number; completed: number; in_progress: number; pending: number }> = {}
    for (const t of tasks) {
      const p = t.phase as number
      if (!phaseMap[p]) phaseMap[p] = { total: 0, completed: 0, in_progress: 0, pending: 0 }
      phaseMap[p].total++
      if (t.status === 'completed')   phaseMap[p].completed++
      if (t.status === 'in_progress') phaseMap[p].in_progress++
      if (t.status === 'pending')     phaseMap[p].pending++
    }

    // Completion metrics
    const completed   = statusMap['completed']   ?? 0
    const inProgress  = statusMap['in_progress'] ?? 0
    const pending     = statusMap['pending']      ?? 0
    const pctComplete = TOTAL > 0 ? Math.round(100 * completed / TOTAL) : 0
    const pctCoverage = TOTAL > 0 ? Math.round(100 * (completed + inProgress) / TOTAL) : 0

    // Next 10 tasks queue (pending, phase-ordered)
    const nextQueue = tasks
      .filter(t => t.status === 'pending')
      .slice(0, 10)
      .map(t => ({ id: t.id, phase: t.phase, module: t.module, title: t.title, priority: t.priority }))

    // Recent 10 executions
    const { data: recentExec } = await supabase
      .from('javari_execution_log')
      .select('roadmap_task_id, task_type, model, cost_usd, duration_ms, status, executed_at, result_summary')
      .order('executed_at', { ascending: false })
      .limit(10)

    // Budget
    const budgetSpent  = await getDailySpend()
    const budgetDaily  = parseFloat(config['BUILD_BUDGET_DAILY_USD'] ?? '1.00')
    const budgetLeft   = Math.max(0, budgetDaily - budgetSpent)
    const budgetPct    = Math.min(100, Math.round(100 * budgetSpent / budgetDaily))

    // Last cycle learning stats
    const lastCycleRaw = config['LEARNING_LAST_CYCLE']
    const lastCycle = lastCycleRaw
      ? (() => { try { return JSON.parse(lastCycleRaw) } catch { return null } })()
      : null

    return NextResponse.json({
      ok:   true,
      source: 'roadmap_master',

      // Core metrics — trusted, stable
      canonical: {
        total:       TOTAL,
        completed,
        in_progress: inProgress,
        pending,
        pct_complete: pctComplete,
        pct_coverage: pctCoverage,
      },

      // Phase breakdown
      phases: Object.fromEntries(
        Object.entries(phaseMap).map(([phase, data]) => [
          phase,
          {
            ...data,
            pct: data.total > 0 ? Math.round(100 * data.completed / data.total) : 0,
          },
        ])
      ),

      // Next tasks queue
      next_queue: nextQueue,

      // Recent executions
      recent_executions: (recentExec ?? []).map(e => ({
        id:          e.roadmap_task_id,
        type:        e.task_type,
        model:       e.model,
        cost:        e.cost_usd,
        duration_ms: e.duration_ms,
        status:      e.status,
        executed_at: e.executed_at,
      })),

      // System state
      system: {
        mode:           config['SYSTEM_MODE']          ?? 'BUILD',
        active_phase:   parseInt(config['ACTIVE_PHASE'] ?? '2', 10),
        budget_daily:   budgetDaily,
        budget_spent:   budgetSpent,
        budget_left:    budgetLeft,
        budget_pct:     budgetPct,
      },

      // Last learning cycle
      last_cycle: lastCycle,

      timestamp: new Date().toISOString(),
    })

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
