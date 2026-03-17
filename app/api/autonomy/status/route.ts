// app/api/autonomy/status/route.ts
// Javari AI — Autonomy status endpoint
// Returns real-time task counts, recent executions, and system health
// Monday, March 16, 2026
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

    // Task counts by status in one query
    const { data: allTasks } = await supabase
      .from('roadmap_tasks')
      .select('status')

    const counts = (allTasks ?? []).reduce<Record<string, number>>((acc, row) => {
      const s = row.status ?? 'unknown'
      acc[s] = (acc[s] ?? 0) + 1
      return acc
    }, {})

    // Latest 10 executed tasks
    const { data: recentTasks } = await supabase
      .from('roadmap_tasks')
      .select('id, title, status, source, assigned_model, cost, completed_at, updated_at')
      .order('updated_at', { ascending: false })
      .limit(10)

    // System config
    const { data: configRows } = await supabase
      .from('javari_system_config')
      .select('key,value')
    const config = Object.fromEntries((configRows ?? []).map((r: { key: string; value: string }) => [r.key, r.value]))

    // Daily spend
    const dailySpend = await getDailySpend()

    // Recent jobs (last 5)
    const { data: recentJobs } = await supabase
      .from('javari_jobs')
      .select('id, task, status, triggered_by, created_at')
      .order('created_at', { ascending: false })
      .limit(5)

    return NextResponse.json({
      ok: true,
      timestamp: new Date().toISOString(),
      system: {
        mode:        config['SYSTEM_MODE'] ?? 'SCAN',
        active_phase: config['ACTIVE_PHASE'] ?? '1',
        budget_daily: parseFloat(config['BUILD_BUDGET_DAILY_USD'] ?? '1.00'),
        budget_spent: parseFloat(dailySpend.toFixed(4)),
        budget_left:  parseFloat(Math.max(0, 1.00 - dailySpend).toFixed(4)),
      },
      tasks: {
        total:       (allTasks ?? []).length,
        pending:     counts['pending']     ?? 0,
        in_progress: counts['in_progress'] ?? 0,
        retry:       counts['retry']       ?? 0,
        verifying:   counts['verifying']   ?? 0,
        blocked:     counts['blocked']     ?? 0,
        completed:   counts['completed']   ?? 0,
        failed:      counts['failed']      ?? 0,
      },
      recent_tasks: (recentTasks ?? []).map(t => ({
        id:            t.id,
        title:         t.title,
        status:        t.status,
        source:        t.source,
        model:         t.assigned_model,
        cost:          t.cost,
        completed_at:  t.completed_at,
        updated_at:    t.updated_at,
      })),
      recent_jobs: recentJobs ?? [],
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ ok: false, error: msg, timestamp: new Date().toISOString() }, { status: 500 })
  }
}
