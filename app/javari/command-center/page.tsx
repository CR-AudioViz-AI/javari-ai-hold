// app/javari/command-center/page.tsx
// Javari OS — Command Center (Deterministic Roadmap Edition)
// ALL data from roadmap_master (275 canonical tasks) — trusted, stable, no drift.
// Tuesday, March 17, 2026
'use client'

import React, { useEffect, useState, useCallback } from 'react'

// ── Types ────────────────────────────────────────────────────────────────────
interface PhaseData {
  total:       number
  completed:   number
  in_progress: number
  pending:     number
  pct:         number
}

interface NextTask {
  id:       string
  phase:    number
  module:   string
  title:    string
  priority: string
}

interface RecentExec {
  id?:         string
  type?:       string
  model?:      string
  cost?:       number
  duration_ms?: number
  status?:     string
  executed_at?: string
}

interface SystemInfo {
  mode:          string
  active_phase:  number
  budget_daily:  number
  budget_spent:  number
  budget_left:   number
  budget_pct:    number
}

interface CanonicalInfo {
  total:        number
  completed:    number
  in_progress:  number
  pending:      number
  pct_complete: number
  pct_coverage: number
}

interface StatusPayload {
  ok:                  boolean
  source?:             string
  canonical?:          CanonicalInfo
  phases?:             Record<string, PhaseData>
  next_queue?:         NextTask[]
  recent_executions?:  RecentExec[]
  system?:             SystemInfo
  last_cycle?:         Record<string, unknown> | null
  error?:              string
}

// ── Priority badge ────────────────────────────────────────────────────────────
const PRIORITY_STYLE: Record<string, string> = {
  critical: 'text-red-400   ring-red-400/30   bg-red-400/10',
  high:     'text-amber-400 ring-amber-400/30 bg-amber-400/10',
  normal:   'text-zinc-400  ring-zinc-400/20  bg-zinc-400/10',
}

const STATUS_DOT: Record<string, string> = {
  completed:   'bg-emerald-400',
  in_progress: 'bg-blue-400',
  pending:     'bg-amber-400',
  failed:      'bg-red-500',
  blocked:     'bg-red-400',
}

function Dot({ status }: { status?: string }) {
  const col   = STATUS_DOT[status ?? ''] ?? 'bg-zinc-500'
  const pulse = status === 'in_progress'
  return (
    <span className="relative inline-flex h-2 w-2 flex-shrink-0">
      {pulse && <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${col} opacity-60`} />}
      <span className={`relative inline-flex rounded-full h-2 w-2 ${col}`} />
    </span>
  )
}

function PriorityBadge({ priority }: { priority?: string }) {
  const cls = PRIORITY_STYLE[priority ?? 'normal'] ?? PRIORITY_STYLE.normal
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded ring-1 font-mono text-[9px] tracking-widest uppercase ${cls}`}>
      {priority ?? 'normal'}
    </span>
  )
}

// ── Phase progress bar ────────────────────────────────────────────────────────
function PhaseBar({ phase, data }: { phase: string; data: PhaseData }) {
  const pct   = data.pct ?? 0
  const names: Record<string, string> = {
    '0': 'Protection',
    '1': 'Core Infra',
    '2': 'Module Factory',
    '3': 'CRAIverse',
    '4': 'Ecosystem',
  }
  const barColor =
    pct === 100 ? 'from-emerald-600 to-emerald-400' :
    pct >= 75   ? 'from-indigo-600  to-blue-400'    :
    pct >= 40   ? 'from-indigo-600  to-violet-500'  :
                  'from-zinc-700    to-zinc-600'

  return (
    <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/40 backdrop-blur-sm p-4">
      <div className="flex items-center justify-between mb-2">
        <div>
          <span className="font-mono text-[10px] text-zinc-500 tracking-widest uppercase">Phase {phase}</span>
          <span className="font-mono text-xs text-zinc-300 ml-2">{names[phase] ?? ''}</span>
        </div>
        <span className={`font-mono text-sm font-bold tabular-nums ${pct === 100 ? 'text-emerald-400' : 'text-zinc-200'}`}>
          {pct}%
        </span>
      </div>
      <div className="w-full h-1.5 bg-zinc-800 rounded-full overflow-hidden mb-2">
        <div
          className={`h-full rounded-full bg-gradient-to-r ${barColor} transition-all duration-700`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="flex gap-4 font-mono text-[10px] text-zinc-600">
        <span className="text-emerald-500">{data.completed} done</span>
        {data.in_progress > 0 && <span className="text-blue-400">{data.in_progress} active</span>}
        <span>{data.pending} pending</span>
        <span className="ml-auto text-zinc-700">{data.total} total</span>
      </div>
    </div>
  )
}

// ── Scanlines ─────────────────────────────────────────────────────────────────
function Scanlines() {
  return (
    <div
      className="pointer-events-none fixed inset-0 z-0"
      style={{
        backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.08) 2px, rgba(0,0,0,0.08) 4px)',
        backgroundSize: '100% 4px',
      }}
    />
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────
export const dynamic = 'force-dynamic'

export default function CommandCenterPage() {
  const [data,    setData]    = useState<StatusPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)
  const [lastAt,  setLastAt]  = useState('')

  const fetchStatus = useCallback(async () => {
    try {
      const res  = await fetch('/api/autonomy/status', { cache: 'no-store' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json: StatusPayload = await res.json()
      if (!json.ok && json.error) throw new Error(json.error)
      setData(json)
      setError(null)
      setLastAt(new Date().toLocaleTimeString())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchStatus()
    const t = setInterval(fetchStatus, 15_000)
    return () => clearInterval(t)
  }, [fetchStatus])

  // ── Loading ───────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <Scanlines />
        <div className="text-center z-10">
          <div className="w-10 h-10 border border-blue-500/50 border-t-blue-400 rounded-full animate-spin mx-auto mb-4" />
          <p className="font-mono text-xs tracking-[0.3em] text-blue-400/70 uppercase">Loading roadmap data…</p>
        </div>
      </div>
    )
  }

  // ── Error ─────────────────────────────────────────────────────────────────
  if (error && !data) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center p-6">
        <Scanlines />
        <div className="z-10 border border-red-800/60 rounded-xl bg-zinc-900/80 backdrop-blur p-8 max-w-md w-full text-center">
          <div className="w-2 h-2 bg-red-500 rounded-full mx-auto mb-4 animate-pulse" />
          <p className="font-mono text-red-400 text-sm tracking-widest uppercase mb-2">System Offline</p>
          <p className="text-zinc-500 text-xs font-mono mb-6">{error}</p>
          <button onClick={fetchStatus} className="px-5 py-2 font-mono text-xs tracking-widest uppercase bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg border border-zinc-700 transition">
            Reconnect
          </button>
        </div>
      </div>
    )
  }

  if (!data) return null

  const canon  = data.canonical
  const sys    = data.system
  const phases = data.phases ?? {}
  const queue  = data.next_queue ?? []
  const recent = data.recent_executions ?? []

  const TOTAL       = canon?.total      ?? 275   // canonical constant
  const completed   = canon?.completed  ?? 0
  const inProgress  = canon?.in_progress ?? 0
  const pending     = canon?.pending    ?? 0
  const pctComplete = canon?.pct_complete ?? 0
  const budgetPct   = sys?.budget_pct   ?? 0

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 relative overflow-hidden">
      <Scanlines />
      <div className="pointer-events-none fixed top-0 left-1/2 -translate-x-1/2 w-[900px] h-[400px] bg-indigo-900/10 rounded-full blur-3xl" />
      <div className="pointer-events-none fixed bottom-0 right-0 w-[500px] h-[300px] bg-violet-900/8 rounded-full blur-3xl" />

      <div className="relative z-10 max-w-7xl mx-auto px-6 py-8 space-y-6">

        {/* ── Header bar ─────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between flex-wrap gap-4 pb-4 border-b border-zinc-800/60">
          <div className="flex items-center gap-3">
            <div className="w-6 h-6 rounded bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center">
              <span className="text-white font-mono text-[10px] font-bold">J</span>
            </div>
            <span className="font-mono text-xs tracking-[0.25em] text-zinc-400 uppercase">Javari OS</span>
            <span className="text-zinc-700 font-mono">·</span>
            <span className="font-mono text-xs tracking-[0.2em] text-zinc-500 uppercase">Command Center</span>
            <span className="font-mono text-[10px] text-emerald-500/60 ml-2">■ ROADMAP_MASTER</span>
          </div>
          <div className="flex items-center gap-6 font-mono text-xs">
            <span className={sys?.mode === 'BUILD' ? 'text-blue-400 font-bold' : 'text-amber-400 font-bold'}>
              {sys?.mode ?? '—'}
            </span>
            <span className="text-zinc-500">Phase <span className="text-zinc-200 font-bold">{sys?.active_phase ?? '—'}</span></span>
            {lastAt && (
              <div className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                <span className="text-zinc-600 text-[10px]">{lastAt}</span>
              </div>
            )}
            <button
              onClick={fetchStatus}
              className="px-3 py-1 rounded border border-zinc-800 bg-zinc-900/60 hover:border-zinc-600 hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 font-mono text-[10px] tracking-widest uppercase transition-all"
            >
              ↻ Sync
            </button>
          </div>
        </div>

        {/* ── Master metrics — THE CANONICAL NUMBERS ─────────────────────── */}
        <div className="rounded-xl border border-indigo-800/40 bg-indigo-900/10 backdrop-blur-sm p-5">
          <p className="font-mono text-[10px] tracking-[0.25em] text-indigo-400/60 uppercase mb-4">Canonical Roadmap Status</p>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
            {[
              { label: 'Total Tasks',  value: TOTAL,      color: 'text-zinc-200' },
              { label: 'Completed',    value: completed,   color: 'text-emerald-400' },
              { label: 'In Progress',  value: inProgress,  color: 'text-blue-400' },
              { label: 'Pending',      value: pending,     color: 'text-amber-400' },
              { label: '% Complete',   value: `${pctComplete}%`, color: pctComplete >= 75 ? 'text-emerald-400' : 'text-indigo-400' },
            ].map(item => (
              <div key={item.label}>
                <p className="font-mono text-[10px] tracking-widest text-zinc-600 uppercase mb-1">{item.label}</p>
                <p className={`font-mono text-3xl font-bold tabular-nums leading-none ${item.color}`}>{item.value}</p>
              </div>
            ))}
          </div>

          {/* Overall progress bar */}
          <div className="mt-4">
            <div className="w-full h-2 bg-zinc-800 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-to-r from-indigo-600 via-blue-500 to-emerald-500 transition-all duration-700"
                style={{ width: `${pctComplete}%` }}
              />
            </div>
            <div className="flex justify-between font-mono text-[10px] text-zinc-700 mt-1">
              <span>0</span>
              <span className="text-indigo-500">{pctComplete}% of 275 canonical tasks</span>
              <span>275</span>
            </div>
          </div>
        </div>

        {/* ── Budget strip ───────────────────────────────────────────────── */}
        <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/40 backdrop-blur-sm p-4">
          <div className="flex items-center justify-between font-mono text-xs mb-2">
            <div className="flex items-center gap-3">
              <span className="text-zinc-500 tracking-widest uppercase text-[10px]">Daily Budget</span>
              <span className="text-zinc-200">${(sys?.budget_spent ?? 0).toFixed(4)}</span>
              <span className="text-zinc-700">/</span>
              <span className="text-zinc-500">${(sys?.budget_daily ?? 1).toFixed(2)}</span>
            </div>
            <span className={`font-bold ${budgetPct > 80 ? 'text-red-400' : budgetPct > 50 ? 'text-amber-400' : 'text-emerald-400'}`}>
              {budgetPct}%  <span className="text-zinc-600 font-normal">${(sys?.budget_left ?? 0).toFixed(4)} left</span>
            </span>
          </div>
          <div className="w-full h-1.5 bg-zinc-800 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-700 ${budgetPct > 80 ? 'bg-gradient-to-r from-red-600 to-red-400' : budgetPct > 50 ? 'bg-gradient-to-r from-amber-600 to-amber-400' : 'bg-gradient-to-r from-indigo-600 to-emerald-400'}`}
              style={{ width: `${budgetPct}%` }}
            />
          </div>
        </div>

        {/* ── Phase breakdown ────────────────────────────────────────────── */}
        <div>
          <p className="font-mono text-[10px] tracking-[0.25em] text-zinc-600 uppercase mb-3">Phase Breakdown</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {[0,1,2,3,4].map(p => {
              const pd = phases[String(p)]
              if (!pd) return null
              return <PhaseBar key={p} phase={String(p)} data={pd} />
            })}
          </div>
        </div>

        {/* ── Next task queue ─────────────────────────────────────────────── */}
        <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/30 backdrop-blur-sm overflow-hidden">
          <div className="px-5 py-3.5 border-b border-zinc-800/60 flex items-center gap-3">
            <div className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
            <span className="font-mono text-[10px] tracking-[0.25em] text-zinc-400 uppercase">Next Task Queue</span>
            <span className="font-mono text-[10px] text-zinc-700">[{queue.length} tasks]</span>
          </div>
          {queue.length === 0 ? (
            <p className="font-mono text-xs text-zinc-700 text-center py-8 tracking-widest">Queue empty — all tasks complete</p>
          ) : (
            <div className="divide-y divide-zinc-800/20">
              {queue.map(task => (
                <div key={task.id} className="px-5 py-2.5 flex items-center gap-4 hover:bg-white/[0.02] transition-colors group">
                  <span className="font-mono text-[10px] text-zinc-600 w-6">P{task.phase}</span>
                  <span className="font-mono text-[10px] text-zinc-600 w-24 truncate">{task.module}</span>
                  <PriorityBadge priority={task.priority} />
                  <span className="font-mono text-xs text-zinc-300 group-hover:text-white transition-colors flex-1 truncate">
                    {task.title}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── Recent executions ───────────────────────────────────────────── */}
        <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/30 backdrop-blur-sm overflow-hidden">
          <div className="px-5 py-3.5 border-b border-zinc-800/60 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
              <span className="font-mono text-[10px] tracking-[0.25em] text-zinc-400 uppercase">Recent Executions</span>
            </div>
            <span className="font-mono text-[10px] text-zinc-700 tracking-widest">AUTO-REFRESH 15s</span>
          </div>
          {recent.length === 0 ? (
            <p className="font-mono text-xs text-zinc-700 text-center py-8 tracking-widest">No executions yet</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-zinc-800/40">
                    {['Task', 'Type', 'Status', 'Model', 'Cost', 'Duration'].map(h => (
                      <th key={h} className="px-5 py-2.5 text-left font-mono text-[9px] tracking-[0.2em] text-zinc-600 uppercase">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {recent.map((ex, i) => (
                    <tr key={ex.id ?? i} className="border-b border-zinc-800/20 hover:bg-white/[0.02] transition-colors group">
                      <td className="px-5 py-3 max-w-xs">
                        <span className="font-mono text-xs text-zinc-300 truncate block group-hover:text-white transition-colors" title={ex.id ?? ''}>
                          {(ex.id ?? '—').split('-').slice(2).join('-').slice(0,40) || ex.id?.slice(0,40)}
                        </span>
                      </td>
                      <td className="px-5 py-3">
                        <span className="font-mono text-[10px] text-zinc-500">{ex.type ?? '—'}</span>
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-1.5">
                          <Dot status={ex.status} />
                          <span className={`font-mono text-[10px] tracking-wider ${STATUS_DOT[ex.status ?? ''] ? '' : 'text-zinc-500'}`}>
                            {ex.status?.toUpperCase() ?? '—'}
                          </span>
                        </div>
                      </td>
                      <td className="px-5 py-3">
                        <span className="font-mono text-[10px] text-zinc-500">{ex.model ?? '—'}</span>
                      </td>
                      <td className="px-5 py-3">
                        <span className="font-mono text-[10px] text-zinc-500 tabular-nums">
                          {ex.cost != null ? `$${Number(ex.cost).toFixed(5)}` : '—'}
                        </span>
                      </td>
                      <td className="px-5 py-3">
                        <span className="font-mono text-[10px] text-zinc-600 tabular-nums">
                          {ex.duration_ms != null ? `${ex.duration_ms}ms` : '—'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* ── Nav links ───────────────────────────────────────────────────── */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {[
            { href: '/command/status',  label: 'Status Dashboard', sub: '/command/status'  },
            { href: '/javari/roadmap',  label: 'Roadmap',          sub: '/javari/roadmap'  },
            { href: '/command/history', label: 'History',          sub: '/command/history' },
          ].map(link => (
            <a key={link.href} href={link.href}
              className="group flex items-center justify-between px-4 py-3 rounded-xl border border-zinc-800/60 bg-zinc-900/30 hover:border-zinc-700 hover:bg-zinc-900/60 transition-all">
              <div>
                <p className="font-mono text-xs text-zinc-300 group-hover:text-white transition-colors">{link.label}</p>
                <p className="font-mono text-[10px] text-zinc-700 mt-0.5">{link.sub}</p>
              </div>
              <span className="font-mono text-zinc-700 group-hover:text-zinc-400 transition-colors text-sm">→</span>
            </a>
          ))}
        </div>

        {/* Non-fatal error */}
        {error && data && (
          <div className="flex items-center gap-3 px-4 py-2.5 rounded-lg border border-amber-800/40 bg-amber-950/20">
            <div className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse flex-shrink-0" />
            <p className="font-mono text-[10px] text-amber-600 tracking-wider">Sync error: {error}</p>
          </div>
        )}

      </div>
    </div>
  )
}
