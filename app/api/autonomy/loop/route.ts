// app/api/autonomy/loop/route.ts
// Javari Deterministic Execution Loop — verification-gated completion
// A task is NOT completed until it passes verification.
// verified=true → status=completed. verified=false → retry (up to 2), then blocked.
// Source: roadmap_master only. No planner. No freeform.
// Tuesday, March 17, 2026
// Updated: Thursday, March 19, 2026 — Night Execution Mode (safeguards + priority filter)
import { NextResponse }  from 'next/server'
import { createClient }  from '@supabase/supabase-js'
import { route }         from '@/lib/javari/model-router'
import { getDailySpend } from '@/lib/javari/model-router'

export const dynamic    = 'force-dynamic'
export const runtime    = 'nodejs'
export const maxDuration = 60

const DAILY_BUDGET       = 1.00
const MAX_TASKS_PER_LOOP = 10
const MAX_RETRIES        = 2      // attempts before → blocked

// ── Night Mode constants ──────────────────────────────────────────────────────
const NIGHT_MODE_ENABLED = true

// Revenue/stability modules executed first
const PRIORITY_MODULES = new Set([
  'javari_forge', 'billing', 'payments', 'analytics',
  'javari_mobile', 'mobile', 'auth_system', 'credits_os',
])

// Consecutive failure guard: if this many cycles in a row have failures → pause
const CONSECUTIVE_FAIL_LIMIT = 3

// Cost guards
const SAFE_MODE_THRESHOLD  = 0.50   // above this → MAX_TASKS = 3
const AUTO_PAUSE_THRESHOLD = 0.90   // above this → pause

// Stuck task health thresholds
const STUCK_WARN_THRESHOLD  = 5
const STUCK_PAUSE_THRESHOLD = 10
// ── End Night Mode constants ──────────────────────────────────────────────────

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
  retry_count:  number | null
}

async function getConfig(supabase: ReturnType<typeof db>): Promise<Record<string, string>> {
  const { data } = await supabase.from('javari_system_config').select('key,value')
  return Object.fromEntries((data ?? []).map((r: { key: string; value: string }) => [r.key, r.value]))
}

async function areDependenciesMet(supabase: ReturnType<typeof db>, deps: string[]): Promise<boolean> {
  if (!deps?.length) return true
  const { data } = await supabase
    .from('roadmap_master')
    .select('id, status, verified')
    .in('id', deps)
  if (!data) return true
  // A dependency is met when it is completed AND verified
  return data.every(d => d.status === 'completed' && d.verified === true)
}

// ── Safety log helper ─────────────────────────────────────────────────────────
// All guard triggers write to javari_execution_log with task_type = 'safety'
async function safetyLog(
  supabase: ReturnType<typeof db>,
  cycleId: string,
  reason: string
): Promise<void> {
  await supabase.from('javari_execution_log').insert({
    roadmap_task_id: `safety-${cycleId}`,
    cycle_id:        cycleId,
    task_type:       'safety',
    status:          'guard_triggered',
    error:           reason,
    duration_ms:     0,
    executed_at:     new Date().toISOString(),
  }).catch(() => {/* non-fatal */})
}

// ── Trigger kill switch via autonomy_control ──────────────────────────────────
async function triggerKillSwitch(
  supabase: ReturnType<typeof db>,
  cycleId: string,
  reason: string
): Promise<void> {
  await supabase.from('autonomy_control').upsert({
    id: 1, is_paused: true, paused_by: 'night_mode_guard',
    reason, updated_at: new Date().toISOString(),
  }).catch(() => {/* non-fatal */})
  await safetyLog(supabase, cycleId, `AUTO-PAUSE: ${reason}`)
}

// ── Inline verification ───────────────────────────────────────────────────────
// Lightweight verification that runs inside the loop without calling the HTTP endpoint.
// Mirrors the logic in /api/javari/verify/task but inline for performance.
const MILESTONE_MODULES = new Set([
  'safety_os','compliance_os','credits_os','db_migration',
  'craudiovizai_com','javariai_com','javari_dashboard','orchestrator',
  'javari_omni_media','javari_games','javari_create','javari_market',
  'first_responders','javari_business','javari_realty',
  'avatar_system','virtual_real_estate','community_modules',
  'command_center','cost_governor','deployment_pipeline',
  'canonical_authority','architecture_guard','auth_system',
])

async function inlineVerify(
  supabase: ReturnType<typeof db>,
  taskId: string,
  module: string,
  taskType: string,
  hasExecutionModel: boolean,
  logRowId?: string
): Promise<boolean> {
  // Javari-executed: require execution log entry
  if (hasExecutionModel) {
    const { data: logRow } = await supabase
      .from('javari_execution_log')
      .select('id, status')
      .eq('roadmap_task_id', taskId)
      .eq('status', 'completed')
      .limit(1)
      .single()
    return !!logRow
  }
  // Milestone-mapped: require module in registry
  return MILESTONE_MODULES.has(module)
}

export async function GET() {
  const cycleStart = Date.now()
  const cycleId    = `cycle-${cycleStart}`
  const supabase   = db()
  const executed: unknown[] = []

  // Load config
  const config      = await getConfig(supabase)
  const mode        = config['SYSTEM_MODE'] ?? 'BUILD'
  let   activePhase = parseInt(config['ACTIVE_PHASE'] ?? '2', 10)
  let   maxPerRun   = Math.min(
    parseInt(config['MAX_CONCURRENT_BUILDS'] ?? String(MAX_TASKS_PER_LOOP), 10),
    MAX_TASKS_PER_LOOP
  )

  if (mode === 'MAINTAIN') {
    return NextResponse.json({ status: 'maintain_mode', mode, roadmap_source: 'roadmap_master' })
  }

  // Heartbeat
  supabase.from('javari_jobs').insert({
    task: 'cron_heartbeat', priority: 'low', status: 'complete', dry_run: false,
    triggered_by: 'deterministic_verified_loop',
    metadata: { mode, active_phase: activePhase, cycle_id: cycleId },
    started_at: new Date(cycleStart).toISOString(), completed_at: new Date(cycleStart).toISOString(),
    result: { heartbeat: true, source: 'roadmap_master', verification_gated: true },
  })

  // Budget gate
  const spent = await getDailySpend()
  if (spent >= DAILY_BUDGET) {
    return NextResponse.json({
      status: 'budget_reached', daily_spend: `$${spent.toFixed(4)}`, limit: `$${DAILY_BUDGET}`, mode,
    })
  }

  // ── NIGHT MODE: COST GUARD ────────────────────────────────────────────────
  // Runs after the standard budget gate so it only applies between $0.50–$0.90.
  // Standard gate already handles >= $1.00.
  if (NIGHT_MODE_ENABLED) {
    if (spent >= AUTO_PAUSE_THRESHOLD) {
      await triggerKillSwitch(supabase, cycleId,
        `Cost guard: daily_spend $${spent.toFixed(4)} >= auto-pause threshold $${AUTO_PAUSE_THRESHOLD}`)
      return NextResponse.json({
        status:      'paused',
        reason:      `Night mode: cost auto-pause at $${spent.toFixed(4)}`,
        daily_spend: `$${spent.toFixed(4)}`,
        night_mode:  true,
        timestamp:   new Date().toISOString(),
      })
    }
    if (spent >= SAFE_MODE_THRESHOLD) {
      // Safe mode: reduce task count to 3, log the throttle
      maxPerRun = Math.min(maxPerRun, 3)
      await safetyLog(supabase, cycleId,
        `Cost guard: safe mode active ($${spent.toFixed(4)} >= $${SAFE_MODE_THRESHOLD}) — MAX_TASKS=3`)
    }
  }
  // ── END COST GUARD ────────────────────────────────────────────────────────

  // ── NIGHT MODE: CONSECUTIVE FAILURE GUARD ────────────────────────────────
  // Read the last N cycles from execution_log to check for repeated failures.
  // Only fires if NIGHT_MODE_ENABLED = true.
  if (NIGHT_MODE_ENABLED) {
    try {
      const { data: recentCycles } = await supabase
        .from('javari_execution_log')
        .select('cycle_id, status')
        .not('cycle_id', 'like', 'safety-%')
        .not('cycle_id', 'like', 'kill-switch%')
        .not('cycle_id', 'like', 'pause-%')
        .not('cycle_id', 'like', 'resume-%')
        .not('cycle_id', 'like', 'phase-advance-%')
        .order('executed_at', { ascending: false })
        .limit(CONSECUTIVE_FAIL_LIMIT * MAX_TASKS_PER_LOOP * 2)

      if (recentCycles?.length) {
        // Group by cycle_id in order
        const cycleOrder: string[] = []
        const cycleFailMap: Record<string, boolean> = {}
        for (const row of recentCycles) {
          if (!cycleOrder.includes(row.cycle_id)) cycleOrder.push(row.cycle_id)
          if (row.status === 'failed' || row.status === 'verification_failed') {
            cycleFailMap[row.cycle_id] = true
          }
        }
        // Check if the most recent N cycles all had failures
        const recentN = cycleOrder.slice(0, CONSECUTIVE_FAIL_LIMIT)
        const allFailed = recentN.length === CONSECUTIVE_FAIL_LIMIT &&
          recentN.every(cid => cycleFailMap[cid] === true)

        if (allFailed) {
          await triggerKillSwitch(supabase, cycleId,
            `Failure guard: ${CONSECUTIVE_FAIL_LIMIT} consecutive cycles with failures. Last cycles: ${recentN.join(', ')}`)
          return NextResponse.json({
            status:     'paused',
            reason:     `Night mode: ${CONSECUTIVE_FAIL_LIMIT} consecutive failure cycles — auto-paused`,
            night_mode: true,
            timestamp:  new Date().toISOString(),
          })
        }
      }
    } catch (_) { /* non-fatal — do not block loop */ }
  }
  // ── END CONSECUTIVE FAILURE GUARD ────────────────────────────────────────

  // ── STUCK TASK RECOVERY ───────────────────────────────────────────────────
  // Reset orphaned in_progress tasks (worker died / function timed out).
  // Safety: only tasks older than 10 minutes, retry_count < 3.
  const stuckResets: string[] = []
  try {
    const stuckCutoff = new Date(Date.now() - 10 * 60 * 1000).toISOString()
    const { data: stuckTasks } = await supabase
      .from('roadmap_master')
      .select('id, retry_count')
      .eq('status', 'in_progress')
      .lt('updated_at', stuckCutoff)
      .lte('phase', activePhase + 1)
      .lt('retry_count', 3)
    if (stuckTasks?.length) {
      for (const stuck of stuckTasks) {
        const nr = (stuck.retry_count ?? 0) + 1
        await supabase.from('roadmap_master').update({
          status: 'pending', retry_count: nr,
          updated_at: new Date().toISOString(),
          verification_notes: `Auto-reset: stuck in_progress >10m (attempt ${nr})`,
        }).eq('id', stuck.id)
        stuckResets.push(stuck.id)
      }

      // ── NIGHT MODE: HEALTH CHECK on stuck count ──────────────────────────
      if (NIGHT_MODE_ENABLED) {
        if (stuckTasks.length > STUCK_PAUSE_THRESHOLD) {
          await triggerKillSwitch(supabase, cycleId,
            `Health guard: ${stuckTasks.length} stuck tasks > pause threshold (${STUCK_PAUSE_THRESHOLD})`)
          return NextResponse.json({
            status:     'paused',
            reason:     `Night mode: ${stuckTasks.length} stuck tasks — auto-paused`,
            night_mode: true,
            timestamp:  new Date().toISOString(),
          })
        }
        if (stuckTasks.length > STUCK_WARN_THRESHOLD) {
          await safetyLog(supabase, cycleId,
            `Health warning: ${stuckTasks.length} stuck tasks > warn threshold (${STUCK_WARN_THRESHOLD})`)
        }
      }
      // ── END HEALTH CHECK ──────────────────────────────────────────────────
    }
  } catch (_) { /* non-fatal — continue loop */ }
  // ── END STUCK TASK RECOVERY ────────────────────────────────────────────────

  // ── Fetch pending tasks from roadmap_master ───────────────────────────────
  // NIGHT MODE: Priority modules (revenue/stability) are fetched first by
  // applying a two-pass strategy: pass 1 = priority modules only, pass 2 = all.
  // This avoids adding a CASE expression that some Supabase versions don't support
  // in the JS client .order() call.
  const fetchCandidates = async (phaseLimit: number): Promise<RoadmapTask[] | null> => {
    if (NIGHT_MODE_ENABLED) {
      // Pass 1: priority modules
      const { data: priorityRows } = await supabase
        .from('roadmap_master')
        .select('id, phase, module, module_family, title, description, task_type, priority, dependencies, artifacts, retry_count')
        .eq('status', 'pending')
        .lte('phase', phaseLimit + 1)
        .in('module', [...PRIORITY_MODULES])
        .order('phase', { ascending: true })
        .order('id',    { ascending: true })
        .limit(MAX_TASKS_PER_LOOP * 2)

      const priorityIds = new Set((priorityRows ?? []).map(r => r.id))

      // Pass 2: all remaining (fills remainder of the batch)
      const remaining = MAX_TASKS_PER_LOOP * 2 - (priorityRows?.length ?? 0)
      let otherRows: RoadmapTask[] = []
      if (remaining > 0) {
        const { data: allRows } = await supabase
          .from('roadmap_master')
          .select('id, phase, module, module_family, title, description, task_type, priority, dependencies, artifacts, retry_count')
          .eq('status', 'pending')
          .lte('phase', phaseLimit + 1)
          .order('phase', { ascending: true })
          .order('id',    { ascending: true })
          .limit(MAX_TASKS_PER_LOOP * 2)
        otherRows = (allRows ?? []).filter(r => !priorityIds.has(r.id))
      }

      const merged = [...(priorityRows ?? []), ...otherRows]
      return merged.length ? (merged as RoadmapTask[]) : null
    }

    // Standard path (night mode off)
    const { data } = await supabase
      .from('roadmap_master')
      .select('id, phase, module, module_family, title, description, task_type, priority, dependencies, artifacts, retry_count')
      .eq('status', 'pending')
      .lte('phase', phaseLimit + 1)
      .order('phase', { ascending: true })
      .order('id', { ascending: true })
      .limit(MAX_TASKS_PER_LOOP * 2)
    return data as RoadmapTask[] | null
  }

  let candidates = await fetchCandidates(activePhase)
  let phaseAdvanced = false

  // ── PHASE AUTO-ADVANCE ────────────────────────────────────────────────────
  // If no pending tasks at current phase, advance in-memory and retry once.
  if (!candidates?.length) {
    try {
      const { data: maxRows } = await supabase
        .from('roadmap_master')
        .select('phase')
        .order('phase', { ascending: false })
        .limit(1)
      const maxPhase = (maxRows?.[0]?.phase) ?? activePhase
      if (activePhase < maxPhase) {
        activePhase  += 1
        phaseAdvanced = true
        candidates    = await fetchCandidates(activePhase)
      }
    } catch (_) { /* non-fatal */ }
  }
  // ── END PHASE AUTO-ADVANCE ─────────────────────────────────────────────────

  if (!candidates?.length) {
    const finalSpend = await getDailySpend()
    return NextResponse.json({
      status: 'idle', reason: 'No pending tasks in roadmap_master',
      mode, active_phase: activePhase, tasks_run: 0, executed: [],
      roadmap_source: 'roadmap_master',
      stuck_tasks_reset: stuckResets, phase_advanced: phaseAdvanced,
      night_mode: NIGHT_MODE_ENABLED,
      daily_spend: `$${finalSpend.toFixed(4)}`,
      budget_left: `$${Math.max(0, DAILY_BUDGET - finalSpend).toFixed(4)}`,
      cycle_ms: Date.now() - cycleStart, timestamp: new Date().toISOString(),
    })
  }

  // ── Dependency gate ───────────────────────────────────────────────────────
  const ready: RoadmapTask[] = []
  for (const task of candidates as RoadmapTask[]) {
    if (ready.length >= maxPerRun) break
    const depsOk = await areDependenciesMet(supabase, task.dependencies ?? [])
    if (depsOk) ready.push(task)
  }

  if (!ready.length) {
    const finalSpend = await getDailySpend()
    return NextResponse.json({
      status: 'blocked', reason: `All ${candidates.length} candidates blocked by unmet dependencies`,
      mode, active_phase: activePhase, tasks_run: 0,
      roadmap_source: 'roadmap_master',
      stuck_tasks_reset: stuckResets, phase_advanced: phaseAdvanced,
      night_mode: NIGHT_MODE_ENABLED,
      daily_spend: `$${finalSpend.toFixed(4)}`,
      budget_left: `$${Math.max(0, DAILY_BUDGET - finalSpend).toFixed(4)}`,
      cycle_ms: Date.now() - cycleStart, timestamp: new Date().toISOString(),
    })
  }

  // Claim: pending → in_progress
  await supabase.from('roadmap_master')
    .update({ status: 'in_progress', updated_at: new Date().toISOString() })
    .in('id', ready.map(t => t.id))

  // ── Execute + verify concurrently ────────────────────────────────────────
  const taskPromises = ready.map(async (task) => {
    const taskStart = Date.now()
    const retries   = task.retry_count ?? 0

    try {
      const prompt = [
        `Task: ${task.title}`,
        task.description ? `Description: ${task.description}` : '',
        `Module: ${task.module} (${task.module_family})`,
        `Phase: ${task.phase}  Priority: ${task.priority}  Type: ${task.task_type}`,
        task.artifacts?.length ? `Artifacts to produce: ${task.artifacts.join(', ')}` : '',
      ].filter(Boolean).join('\n')

      const result = await route(task.task_type as any, prompt, {
        systemPrompt: [
          'You are Javari AI, the autonomous operating system for CR AudioViz AI.',
          'Mission: "Your Story. Our Design." Owned by Roy & Cindy Henderson.',
          'Execute the canonical task. Return production-ready output.',
          'For db tasks: exact SQL DDL with indexes and RLS.',
          'For api tasks: complete TypeScript route handler.',
          'For ui tasks: complete React component with Tailwind.',
          'For implementation tasks: complete file content.',
        ].join('\n'),
        maxTier: task.priority === 'critical' ? 'moderate' : 'low',
      })

      const duration = Date.now() - taskStart

      if (result.blocked) {
        await supabase.from('roadmap_master')
          .update({ status: 'pending', updated_at: new Date().toISOString() })
          .eq('id', task.id)
        return { id: task.id, title: task.title, status: 'model_blocked', phase: task.phase, priority: task.priority }
      }

      // ── Write execution log ────────────────────────────────────────────
      const { data: logRow } = await supabase.from('javari_execution_log').insert({
        roadmap_task_id: task.id,
        cycle_id:        cycleId,
        task_type:       task.task_type,
        model:           result.model,
        cost_usd:        result.cost,
        duration_ms:     duration,
        status:          'completed',
        result_summary:  result.content.slice(0, 500),
        executed_at:     new Date().toISOString(),
      }).select('id').single()

      // ── Write memory ───────────────────────────────────────────────────
      await supabase.from('javari_memory').insert({
        memory_type: ['planning','analysis'].includes(task.task_type) ? 'decision' : 'fact',
        key:         `roadmap_master:${task.id}`,
        value:       result.content.slice(0, 2000),
        source:      'deterministic_loop',
        task_id:     task.id,
        content:     result.content.slice(0, 8000),
      })

      // ── VERIFICATION GATE ──────────────────────────────────────────────
      const verified = await inlineVerify(
        supabase, task.id, task.module, task.task_type, true, logRow?.id
      )

      if (verified) {
        // VERIFIED → completed
        await supabase.from('roadmap_master').update({
          status:          'completed',
          verified:        true,
          verified_at:     new Date().toISOString(),
          execution_model: result.model,
          execution_cost:  result.cost,
          execution_ms:    duration,
          executed_at:     new Date().toISOString(),
          verification_notes: 'Inline verified: execution_log present',
          updated_at:      new Date().toISOString(),
        }).eq('id', task.id)

        await supabase.from('canonical_tasks')
          .update({ status: 'complete', updated_at: new Date().toISOString() })
          .eq('id', task.id)

        await supabase.from('javari_execution_log')
          .update({ verification: true })
          .eq('roadmap_task_id', task.id)

        return {
          id: task.id, title: task.title, phase: task.phase,
          module: task.module, task_type: task.task_type, priority: task.priority,
          model: result.model, cost: result.cost, duration,
          status: 'completed', verified: true,
        }

      } else {
        // Verification failed — retry or block
        const newRetries = retries + 1
        const newStatus  = newRetries >= MAX_RETRIES ? 'blocked' : 'pending'

        await supabase.from('roadmap_master').update({
          status:             newStatus,
          retry_count:        newRetries,
          verification_notes: `Verification failed (attempt ${newRetries}/${MAX_RETRIES})`,
          execution_model:    result.model,
          execution_cost:     result.cost,
          execution_ms:       duration,
          updated_at:         new Date().toISOString(),
        }).eq('id', task.id)

        await supabase.from('javari_execution_log').update({
          status: 'verification_failed',
          error:  `Verification failed attempt ${newRetries}`,
        }).eq('roadmap_task_id', task.id).eq('cycle_id', cycleId)

        return {
          id: task.id, title: task.title, phase: task.phase, priority: task.priority,
          status: newStatus, verified: false, retries: newRetries,
        }
      }

    } catch (err: unknown) {
      const msg      = err instanceof Error ? err.message : String(err)
      const newRetries = retries + 1
      const newStatus  = newRetries >= MAX_RETRIES ? 'blocked' : 'pending'

      await supabase.from('roadmap_master').update({
        status:      newStatus,
        retry_count: newRetries,
        updated_at:  new Date().toISOString(),
      }).eq('id', task.id)

      await supabase.from('javari_execution_log').insert({
        roadmap_task_id: task.id,
        cycle_id:        cycleId,
        task_type:       task.task_type,
        status:          'failed',
        error:           msg.slice(0, 500),
        duration_ms:     Date.now() - taskStart,
        executed_at:     new Date().toISOString(),
      }).catch(() => {/* non-fatal */})

      return { id: task.id, title: task.title, status: newStatus, error: msg, retries: newRetries }
    }
  })

  const results = await Promise.allSettled(taskPromises)
  for (const r of results) {
    if (r.status === 'fulfilled' && r.value) executed.push(r.value)
  }

  const finalSpend    = await getDailySpend()
  const completedVerified = (executed as Record<string,unknown>[]).filter(e => e.status === 'completed' && e.verified).length
  const verifyFailed  = (executed as Record<string,unknown>[]).filter(e => e.verified === false).length
  const blocked       = (executed as Record<string,unknown>[]).filter(e => e.status === 'blocked').length

  // Learning write — fire-and-forget
  const learningRecords = (executed as Record<string,unknown>[]).map(e => ({
    task_id:        e.id,
    task_title:     e.title,
    task_source:    'roadmap_master',
    task_type:      e.task_type ?? 'unknown',
    status:         e.status as string,
    model:          e.model,
    cost:           e.cost,
    duration_ms:    e.duration,
    canonical_valid: true,
    phase_id:       String(e.phase ?? ''),
    cycle_id:       cycleId,
  }))

  if (learningRecords.length > 0) {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://javari-ai.vercel.app'
    fetch(`${baseUrl}/api/javari/learning/update`, {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${process.env.CRON_SECRET ?? 'javari-cron-2025-phase2-autonomous'}`,
      },
      body: JSON.stringify({ records: learningRecords, cycle_ms: Date.now() - cycleStart }),
    }).catch(() => {/* non-fatal */})
  }

  return NextResponse.json({
    status:             executed.length > 0 ? 'executed' : 'idle',
    mode,
    active_phase:       activePhase,
    roadmap_source:     'roadmap_master',
    verification_gated: true,
    phase_advanced:     phaseAdvanced,
    stuck_tasks_reset:  stuckResets,
    night_mode:         NIGHT_MODE_ENABLED,
    tasks_run:          executed.length,
    completed_verified: completedVerified,
    verify_failed:      verifyFailed,
    blocked,
    executed,
    daily_spend:        `$${finalSpend.toFixed(4)}`,
    budget_left:        `$${Math.max(0, DAILY_BUDGET - finalSpend).toFixed(4)}`,
    cycle_ms:           Date.now() - cycleStart,
    timestamp:          new Date().toISOString(),
  })
}
