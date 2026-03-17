// app/api/autonomy/status/route.ts
// Javari OS — Trusted Status from roadmap_master
// Shows VERIFIED vs COMPLETED distinction — the system is not done until verified.
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

    const { data: configRows } = await supabase
      .from('javari_system_config')
      .select('key,value')
    const config = Object.fromEntries(
      (configRows ?? []).map((r: { key: string; value: string }) => [r.key, r.value])
    )

    // Load all roadmap_master tasks
    const { data: allTasks } = await supabase
      .from('roadmap_master')
      .select('id, phase, status, priority, module, module_family, title, executed_at, execution_model, execution_cost, verified, retry_count')
      .order('phase', { ascending: true })

    const tasks = allTasks ?? []
    const TOTAL = tasks.length  // 275 — canonical fixed

    // Status counts
    const completed  = tasks.filter(t => t.status === 'completed').length
    const verified   = tasks.filter(t => t.verified === true).length
    const inProgress = tasks.filter(t => t.status === 'in_progress').length
    const pending    = tasks.filter(t => t.status === 'pending').length
    const blocked    = tasks.filter(t => t.status === 'blocked').length

    // Unverified completed tasks (completed but not yet verified)
    const unverifiedCompleted = tasks.filter(t => t.status === 'completed' && t.verified === false).length

    const pctComplete = TOTAL > 0 ? Math.round(100 * completed / TOTAL) : 0
    const pctVerified = TOTAL > 0 ? Math.round(100 * verified  / TOTAL) : 0
    const pctTrusted  = pctVerified  // "trusted" = verified

    // Phase breakdown with verified counts
    const phaseMap: Record<number, {
      total: number; completed: number; verified: number; in_progress: number; pending: number; blocked: number; pct: number; pct_verified: number
    }> = {}
    for (const t of tasks) {
      const p = t.phase as number
      if (!phaseMap[p]) phaseMap[p] = { total: 0, completed: 0, verified: 0, in_progress: 0, pending: 0, blocked: 0, pct: 0, pct_verified: 0 }
      phaseMap[p].total++
      if (t.status === 'completed')   phaseMap[p].completed++
      if (t.verified === true)        phaseMap[p].verified++
      if (t.status === 'in_progress') phaseMap[p].in_progress++
      if (t.status === 'pending')     phaseMap[p].pending++
      if (t.status === 'blocked')     phaseMap[p].blocked++
    }
    for (const p of Object.keys(phaseMap)) {
      const pd = phaseMap[Number(p)]
      pd.pct          = pd.total > 0 ? Math.round(100 * pd.completed / pd.total) : 0
      pd.pct_verified = pd.total > 0 ? Math.round(100 * pd.verified  / pd.total) : 0
    }

    // Next queue: pending tasks with dependencies met (simplified — top 10 by phase)
    const nextQueue = tasks
      .filter(t => t.status === 'pending')
      .slice(0, 10)
      .map(t => ({ id: t.id, phase: t.phase, module: t.module, title: t.title, priority: t.priority }))

    // Unverified tasks requiring attention (completed but verified=false)
    const needsVerification = tasks
      .filter(t => t.status === 'completed' && t.verified === false && t.execution_model)
      .slice(0, 10)
      .map(t => ({ id: t.id, phase: t.phase, module: t.module, title: t.title, execution_model: t.execution_model }))

    // Recent executions from log
    const { data: recentExec } = await supabase
      .from('javari_execution_log')
      .select('roadmap_task_id, task_type, model, cost_usd, duration_ms, status, verification, executed_at')
      .order('executed_at', { ascending: false })
      .limit(10)

    // Budget
    const budgetSpent = await getDailySpend()
    const budgetDaily = parseFloat(config['BUILD_BUDGET_DAILY_USD'] ?? '1.00')
    const budgetLeft  = Math.max(0, budgetDaily - budgetSpent)
    const budgetPct   = Math.min(100, Math.round(100 * budgetSpent / budgetDaily))

    // Last cycle
    const lastCycle = (() => {
      try { return config['LEARNING_LAST_CYCLE'] ? JSON.parse(config['LEARNING_LAST_CYCLE']) : null }
      catch { return null }
    })()

    return NextResponse.json({
      ok:     true,
      source: 'roadmap_master',
      verification_gated: true,

      // Core numbers — stable, trusted
      canonical: {
        total:               TOTAL,
        completed,
        verified,
        unverified_completed: unverifiedCompleted,
        in_progress:         inProgress,
        pending,
        blocked,
        pct_complete:        pctComplete,
        pct_verified:        pctVerified,
        pct_trusted:         pctTrusted,
      },

      phases: Object.fromEntries(
        Object.entries(phaseMap).map(([p, d]) => [p, d])
      ),

      next_queue:         nextQueue,
      needs_verification: needsVerification,

      recent_executions: (recentExec ?? []).map(e => ({
        id:           e.roadmap_task_id,
        type:         e.task_type,
        model:        e.model,
        cost:         e.cost_usd,
        duration_ms:  e.duration_ms,
        status:       e.status,
        verification: e.verification,
        executed_at:  e.executed_at,
      })),

      system: {
        mode:         config['SYSTEM_MODE']    ?? 'BUILD',
        active_phase: parseInt(config['ACTIVE_PHASE'] ?? '2', 10),
        budget_daily:  budgetDaily,
        budget_spent:  budgetSpent,
        budget_left:   budgetLeft,
        budget_pct:    budgetPct,
      },

      last_cycle: lastCycle,
      timestamp:  new Date().toISOString(),
    })

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
