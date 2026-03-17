// app/api/javari/learning/update/route.ts
// Javari Learning Loop — POST endpoint to record execution outcomes
// Called by the autonomy loop after each task batch completes.
// Writes to javari_memory (exists) and builds cost/success pattern data.
// Tuesday, March 17, 2026

import { NextRequest, NextResponse } from 'next/server'
import { createClient }              from '@supabase/supabase-js'

export const dynamic    = 'force-dynamic'
export const runtime    = 'nodejs'
export const maxDuration = 10

interface ExecutionRecord {
  task_id:      string
  task_title:   string
  task_source:  string
  task_type:    string
  status:       'completed' | 'failed' | 'blocked' | 'rejected'
  model?:       string
  cost?:        number
  duration_ms?: number
  error?:       string
  canonical_valid: boolean
  phase_id?:    string
  cycle_id:     string
}

function db() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export async function POST(req: NextRequest) {
  // Validate auth
  const auth = req.headers.get('authorization') ?? ''
  if (!auth.includes(process.env.CRON_SECRET ?? 'javari-cron-2025-phase2-autonomous')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await req.json() as { records: ExecutionRecord[]; cycle_ms?: number }
    const { records = [], cycle_ms } = body

    if (!records.length) {
      return NextResponse.json({ ok: true, written: 0, message: 'No records to write' })
    }

    const supabase = db()

    // Write each record to javari_memory with structured learning data
    const memoryInserts = records.map(r => ({
      memory_type: r.status === 'completed' ? 'fact' : 'decision',
      key:         `execution:${r.task_id}`,
      value:       JSON.stringify({
        status:    r.status,
        model:     r.model,
        cost:      r.cost,
        canonical: r.canonical_valid,
      }),
      source:      `learning_loop:${r.task_source}`,
      task_id:     r.cycle_id,
      content:     JSON.stringify({
        task_id:         r.task_id,
        task_title:      r.task_title,
        task_source:     r.task_source,
        task_type:       r.task_type,
        status:          r.status,
        model:           r.model ?? null,
        cost_usd:        r.cost ?? null,
        duration_ms:     r.duration_ms ?? null,
        error:           r.error ?? null,
        canonical_valid: r.canonical_valid,
        phase_id:        r.phase_id ?? null,
        cycle_id:        r.cycle_id,
        recorded_at:     new Date().toISOString(),
      }),
    }))

    const { error: memErr } = await supabase
      .from('javari_memory')
      .insert(memoryInserts)

    if (memErr) throw new Error(`Memory write failed: ${memErr.message}`)

    // Aggregate learning stats — count successes/failures per task_type and source
    const stats = records.reduce<Record<string, {
      count: number; success: number; total_cost: number; avg_duration: number
    }>>((acc, r) => {
      const key = `${r.task_source}:${r.task_type}`
      if (!acc[key]) acc[key] = { count: 0, success: 0, total_cost: 0, avg_duration: 0 }
      acc[key].count++
      if (r.status === 'completed') acc[key].success++
      acc[key].total_cost += r.cost ?? 0
      acc[key].avg_duration += r.duration_ms ?? 0
      return acc
    }, {})

    // Write aggregate to javari_system_config as a learnable signal
    // (upsert a special LEARNING_LAST_CYCLE key for monitoring)
    const cycleData = {
      total_tasks:    records.length,
      completed:      records.filter(r => r.status === 'completed').length,
      failed:         records.filter(r => r.status === 'failed').length,
      rejected:       records.filter(r => r.status === 'rejected').length,
      canonical_rate: Math.round(100 * records.filter(r => r.canonical_valid).length / records.length),
      total_cost:     records.reduce((s, r) => s + (r.cost ?? 0), 0),
      cycle_ms,
      recorded_at:    new Date().toISOString(),
    }

    await supabase.from('javari_system_config')
      .upsert({ key: 'LEARNING_LAST_CYCLE', value: JSON.stringify(cycleData) })

    return NextResponse.json({
      ok:          true,
      written:     memoryInserts.length,
      stats,
      cycle_summary: cycleData,
      timestamp:   new Date().toISOString(),
    })

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}

// GET — return recent learning data
export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization') ?? ''
  if (!auth.includes(process.env.CRON_SECRET ?? 'javari-cron-2025-phase2-autonomous')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const supabase = db()

    // Get last 20 execution records from memory
    const { data: recent } = await supabase
      .from('javari_memory')
      .select('key, value, content, created_at')
      .like('key', 'execution:%')
      .order('created_at', { ascending: false })
      .limit(20)

    // Get last cycle summary from config
    const { data: configRows } = await supabase
      .from('javari_system_config')
      .select('value')
      .eq('key', 'LEARNING_LAST_CYCLE')
      .single()

    const lastCycle = configRows?.value
      ? (() => { try { return JSON.parse(configRows.value) } catch { return null } })()
      : null

    // Parse recent records
    const parsed = (recent ?? []).map(r => {
      try { return JSON.parse(r.content ?? '{}') } catch { return { key: r.key } }
    })

    // Compute success rate
    const successRate = parsed.length > 0
      ? Math.round(100 * parsed.filter(r => r.status === 'completed').length / parsed.length)
      : 0

    return NextResponse.json({
      ok:            true,
      last_cycle:    lastCycle,
      success_rate:  successRate,
      recent_count:  parsed.length,
      recent:        parsed.slice(0, 10),
      timestamp:     new Date().toISOString(),
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
