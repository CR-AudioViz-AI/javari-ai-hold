// app/javari/command-center/page.tsx
// Javari OS — Command Center
// Design: Mission Control / Deep Space Ops — dark, monospace, phosphor accents
// Tuesday, March 17, 2026
'use client'

import React, { useEffect, useState, useCallback } from 'react'

// ── Types (unchanged) ─────────────────────────────────────────────────────────
interface TaskCounts {
  total:        number
  pending:      number
  in_progress:  number
  retry:        number
  verifying:    number
  blocked:      number
  completed:    number
  failed:       number
}

interface RecentTask {
  id:            string
  title:         string
  status:        string
  source?:       string
  model?:        string
  cost?:         number
  updated_at?:   string | number
  completed_at?: string
}

interface SystemInfo {
  mode:          string
  active_phase:  string
  budget_daily:  number
  budget_spent:  number
  budget_left:   number
}

interface StatusPayload {
  ok:             boolean
  timestamp?:     string
  system?:        SystemInfo
  tasks?:         TaskCounts
  recent_tasks?:  RecentTask[]
  error?:         string
}

// ── Status config ─────────────────────────────────────────────────────────────
const STATUS_CFG: Record<string, { dot: string; text: string; ring: string; label: string }> = {
  pending:     { dot: 'bg-amber-400',    text: 'text-amber-400',    ring: 'ring-amber-400/30',  label: 'PENDING'     },
  in_progress: { dot: 'bg-blue-400',     text: 'text-blue-400',     ring: 'ring-blue-400/30',   label: 'IN PROGRESS' },
  retry:       { dot: 'bg-orange-400',   text: 'text-orange-400',   ring: 'ring-orange-400/30', label: 'RETRY'       },
  verifying:   { dot: 'bg-violet-400',   text: 'text-violet-400',   ring: 'ring-violet-400/30', label: 'VERIFYING'   },
  blocked:     { dot: 'bg-red-500',      text: 'text-red-400',      ring: 'ring-red-400/30',    label: 'BLOCKED'     },
  completed:   { dot: 'bg-emerald-400',  text: 'text-emerald-400',  ring: 'ring-emerald-400/30',label: 'COMPLETED'   },
  failed:      { dot: 'bg-red-600',      text: 'text-red-500',      ring: 'ring-red-500/30',    label: 'FAILED'      },
  running:     { dot: 'bg-blue-400',     text: 'text-blue-400',     ring: 'ring-blue-400/30',   label: 'IN PROGRESS' }, // legacy
}

function getStatus(status?: string) {
  return STATUS_CFG[status ?? ''] ?? { dot: 'bg-zinc-500', text: 'text-zinc-400', ring: 'ring-zinc-400/20', label: status?.toUpperCase() ?? 'UNKNOWN' }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function formatUpdated(raw?: string | number): string {
  if (!raw) return '—'
  try {
    const d = typeof raw === 'number' ? new Date(raw) : new Date(raw)
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  } catch { return '—' }
}

// ── Sub-components ────────────────────────────────────────────────────────────

/** Pulsing status dot */
function Dot({ status }: { status?: string }) {
  const cfg = getStatus(status)
  const isActive = status === 'in_progress' || status === 'running'
  return (
    <span className="relative inline-flex h-2 w-2 flex-shrink-0">
      {isActive && (
        <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${cfg.dot} opacity-60`} />
      )}
      <span className={`relative inline-flex rounded-full h-2 w-2 ${cfg.dot}`} />
    </span>
  )
}

/** Status badge — monospace pill */
function Badge({ status }: { status?: string }) {
  const cfg = getStatus(status)
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded ring-1 ${cfg.ring} bg-black/40 font-mono text-[10px] tracking-widest ${cfg.text}`}>
      <Dot status={status} />
      {cfg.label}
    </span>
  )
}

/** Metric tile */
function MetricTile({
  label, value, accent, glow = false,
}: { label: string; value: number; accent: string; glow?: boolean }) {
  return (
    <div className={`
      relative overflow-hidden rounded-xl border border-zinc-800/80
      bg-gradient-to-b from-zinc-900/90 to-zinc-950/90
      backdrop-blur-sm p-5
      ${glow ? 'shadow-lg shadow-blue-900/20' : ''}
      group hover:border-zinc-700 transition-all duration-300
    `}>
      {/* corner accent */}
      <div className="absolute top-0 right-0 w-12 h-12 bg-gradient-to-bl from-white/[0.03] to-transparent rounded-bl-xl" />
      <p className="font-mono text-[10px] tracking-[0.2em] text-zinc-500 uppercase mb-3">{label}</p>
      <p className={`font-mono text-4xl font-bold tabular-nums ${accent} leading-none`}>
        {value.toLocaleString()}
      </p>
    </div>
  )
}

/** Scanline overlay for CRT texture */
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

// ── Main Page ─────────────────────────────────────────────────────────────────
export const dynamic = 'force-dynamic'

export default function CommandCenterPage() {
  const [data,    setData]    = useState<StatusPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)
  const [lastAt,  setLastAt]  = useState<string>('')
  const [tick,    setTick]    = useState(0)

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/autonomy/status', { cache: 'no-store' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json: StatusPayload = await res.json()
      if (!json.ok && json.error) throw new Error(json.error)
      setData(json)
      setError(null)
      setLastAt(new Date().toLocaleTimeString())
      setTick(t => t + 1)
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

  // Safe-extract with fallbacks
  const sys    = data?.system
  const tasks  = data?.tasks
  const recent = data?.recent_tasks ?? []

  const budgetPct = sys
    ? Math.min(100, Math.round(100 * (sys.budget_spent ?? 0) / (sys.budget_daily || 1)))
    : 0

  // ── Loading ────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <Scanlines />
        <div className="text-center z-10">
          <div className="w-10 h-10 border border-blue-500/50 border-t-blue-400 rounded-full animate-spin mx-auto mb-4" />
          <p className="font-mono text-xs tracking-[0.3em] text-blue-400/70 uppercase">
            Command Center loading…
          </p>
        </div>
      </div>
    )
  }

  // ── Error (never blank) ────────────────────────────────────────────────────
  if (error && !data) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center p-6">
        <Scanlines />
        <div className="z-10 border border-red-800/60 rounded-xl bg-zinc-900/80 backdrop-blur p-8 max-w-md w-full text-center">
          <div className="w-2 h-2 bg-red-500 rounded-full mx-auto mb-4 animate-pulse" />
          <p className="font-mono text-red-400 text-sm tracking-widest uppercase mb-2">System Offline</p>
          <p className="text-zinc-500 text-xs font-mono mb-6">{error}</p>
          <button
            onClick={fetchStatus}
            className="px-5 py-2 font-mono text-xs tracking-widest uppercase bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg border border-zinc-700 transition"
          >
            Reconnect
          </button>
        </div>
      </div>
    )
  }

  // ── No data ────────────────────────────────────────────────────────────────
  if (!data) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <Scanlines />
        <p className="font-mono text-zinc-600 text-xs tracking-widest uppercase z-10">
          No data available — retrying…
        </p>
      </div>
    )
  }

  // ── Main render ────────────────────────────────────────────────────────────
  const modeColor = sys?.mode === 'BUILD' ? 'text-blue-400' :
                    sys?.mode === 'SCAN'  ? 'text-violet-400' : 'text-amber-400'

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 relative overflow-hidden">
      <Scanlines />

      {/* Background gradient bloom */}
      <div className="pointer-events-none fixed top-0 left-1/2 -translate-x-1/2 w-[900px] h-[400px] bg-indigo-900/10 rounded-full blur-3xl" />
      <div className="pointer-events-none fixed bottom-0 right-0 w-[500px] h-[300px] bg-violet-900/8 rounded-full blur-3xl" />

      <div className="relative z-10 max-w-7xl mx-auto px-6 py-8 space-y-6">

        {/* ── Top status bar ───────────────────────────────────────────────── */}
        <div className="flex items-center justify-between flex-wrap gap-4 pb-4 border-b border-zinc-800/60">
          <div className="flex items-center gap-4">
            {/* Logo mark */}
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center">
                <span className="text-white font-mono text-[10px] font-bold">J</span>
              </div>
              <span className="font-mono text-xs tracking-[0.25em] text-zinc-400 uppercase">
                Javari OS
              </span>
              <span className="text-zinc-700 font-mono text-xs">·</span>
              <span className="font-mono text-xs tracking-[0.2em] text-zinc-500 uppercase">
                Command Center
              </span>
            </div>
          </div>

          <div className="flex items-center gap-6 font-mono text-xs">
            {/* Mode */}
            <div className="flex items-center gap-2">
              <span className="text-zinc-600 tracking-widest uppercase text-[10px]">Mode</span>
              <span className={`${modeColor} tracking-widest font-bold`}>{sys?.mode ?? '—'}</span>
            </div>
            {/* Phase */}
            <div className="flex items-center gap-2">
              <span className="text-zinc-600 tracking-widest uppercase text-[10px]">Phase</span>
              <span className="text-zinc-300 font-bold">{sys?.active_phase ?? '—'}</span>
            </div>
            {/* Last update */}
            {lastAt && (
              <div className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                <span className="text-zinc-500 text-[10px]">{lastAt}</span>
              </div>
            )}
            {/* Refresh */}
            <button
              onClick={fetchStatus}
              className="px-3 py-1 rounded border border-zinc-800 bg-zinc-900/60 hover:border-zinc-600 hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 tracking-widest text-[10px] uppercase transition-all"
            >
              ↻ Sync
            </button>
          </div>
        </div>

        {/* ── Budget strip ─────────────────────────────────────────────────── */}
        <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/40 backdrop-blur-sm p-4">
          <div className="flex items-center justify-between font-mono text-xs mb-3">
            <div className="flex items-center gap-3">
              <span className="text-zinc-500 tracking-widest uppercase text-[10px]">Daily Budget</span>
              <span className="text-zinc-200">${(sys?.budget_spent ?? 0).toFixed(4)}</span>
              <span className="text-zinc-700">/</span>
              <span className="text-zinc-500">${(sys?.budget_daily ?? 1).toFixed(2)}</span>
            </div>
            <div className="flex items-center gap-3">
              <span className={`${budgetPct > 80 ? 'text-red-400' : budgetPct > 50 ? 'text-amber-400' : 'text-emerald-400'} font-bold`}>
                {budgetPct}%
              </span>
              <span className="text-zinc-600 text-[10px] tracking-widest">
                ${(sys?.budget_left ?? 0).toFixed(4)} remaining
              </span>
            </div>
          </div>
          {/* Budget bar */}
          <div className="w-full h-1.5 bg-zinc-800 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-1000 ${
                budgetPct > 80 ? 'bg-gradient-to-r from-red-600 to-red-400' :
                budgetPct > 50 ? 'bg-gradient-to-r from-amber-600 to-amber-400' :
                'bg-gradient-to-r from-indigo-600 to-emerald-400'
              }`}
              style={{ width: `${budgetPct}%` }}
            />
          </div>
        </div>

        {/* ── Metric grid ──────────────────────────────────────────────────── */}
        <div>
          <p className="font-mono text-[10px] tracking-[0.25em] text-zinc-600 uppercase mb-3">
            Task Lifecycle
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <MetricTile label="Pending"     value={tasks?.pending     ?? 0} accent="text-amber-400"   />
            <MetricTile label="In Progress" value={tasks?.in_progress ?? 0} accent="text-blue-400"    glow />
            <MetricTile label="Retry"       value={tasks?.retry       ?? 0} accent="text-orange-400"  />
            <MetricTile label="Verifying"   value={tasks?.verifying   ?? 0} accent="text-violet-400"  />
            <MetricTile label="Blocked"     value={tasks?.blocked     ?? 0} accent="text-red-400"     />
            <MetricTile label="Completed"   value={tasks?.completed   ?? 0} accent="text-emerald-400" />
            <MetricTile label="Failed"      value={tasks?.failed      ?? 0} accent="text-red-500"     />
            <MetricTile label="Total"       value={tasks?.total       ?? 0} accent="text-zinc-300"    />
          </div>
        </div>

        {/* ── Live task feed ───────────────────────────────────────────────── */}
        <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/30 backdrop-blur-sm overflow-hidden">

          {/* Table header bar */}
          <div className="px-5 py-3.5 border-b border-zinc-800/60 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
              <span className="font-mono text-[10px] tracking-[0.25em] text-zinc-400 uppercase">
                Live Task Feed
              </span>
              <span className="font-mono text-[10px] text-zinc-700">
                [{(recent ?? []).length} entries]
              </span>
            </div>
            <span className="font-mono text-[10px] text-zinc-700 tracking-widest">
              AUTO-REFRESH 15s
            </span>
          </div>

          {(recent ?? []).length === 0 ? (
            <div className="px-5 py-12 text-center">
              <p className="font-mono text-xs tracking-widest text-zinc-700 uppercase">
                No tasks recorded
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-zinc-800/40">
                    {['Task', 'Status', 'Source', 'Model', 'Cost', 'Updated'].map(h => (
                      <th
                        key={h}
                        className="px-5 py-2.5 text-left font-mono text-[9px] tracking-[0.2em] text-zinc-600 uppercase"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(recent ?? []).map((task, i) => (
                    <tr
                      key={task?.id ?? i}
                      className="border-b border-zinc-800/20 hover:bg-white/[0.02] transition-colors group"
                    >
                      <td className="px-5 py-3 max-w-xs">
                        <span
                          className="block truncate font-mono text-xs text-zinc-200 group-hover:text-white transition-colors"
                          title={task?.title ?? ''}
                        >
                          {task?.title ?? '—'}
                        </span>
                      </td>
                      <td className="px-5 py-3">
                        <Badge status={task?.status} />
                      </td>
                      <td className="px-5 py-3">
                        <span className="font-mono text-[10px] text-zinc-600 tracking-wider">
                          {task?.source ?? '—'}
                        </span>
                      </td>
                      <td className="px-5 py-3">
                        <span className="font-mono text-[10px] text-zinc-500">
                          {task?.model ?? '—'}
                        </span>
                      </td>
                      <td className="px-5 py-3">
                        <span className="font-mono text-[10px] text-zinc-500 tabular-nums">
                          {task?.cost != null
                            ? `$${Number(task.cost).toFixed(5)}`
                            : '—'}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-right">
                        <span className="font-mono text-[10px] text-zinc-700 tabular-nums">
                          {formatUpdated(task?.updated_at)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* ── Quick nav ────────────────────────────────────────────────────── */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {[
            { href: '/command/status',  label: 'Status Dashboard', sub: '/command/status'  },
            { href: '/javari/roadmap',  label: 'Roadmap',          sub: '/javari/roadmap'  },
            { href: '/command/history', label: 'History',          sub: '/command/history' },
          ].map(link => (
            <a
              key={link.href}
              href={link.href}
              className="group flex items-center justify-between px-4 py-3 rounded-xl border border-zinc-800/60 bg-zinc-900/30 hover:border-zinc-700 hover:bg-zinc-900/60 transition-all"
            >
              <div>
                <p className="font-mono text-xs text-zinc-300 group-hover:text-white transition-colors">
                  {link.label}
                </p>
                <p className="font-mono text-[10px] text-zinc-700 mt-0.5">{link.sub}</p>
              </div>
              <span className="font-mono text-zinc-700 group-hover:text-zinc-400 transition-colors text-sm">
                →
              </span>
            </a>
          ))}
        </div>

        {/* Error banner (non-fatal) */}
        {error && data && (
          <div className="flex items-center gap-3 px-4 py-2.5 rounded-lg border border-amber-800/40 bg-amber-950/20">
            <div className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse flex-shrink-0" />
            <p className="font-mono text-[10px] text-amber-600 tracking-wider">
              Partial sync error: {error}
            </p>
          </div>
        )}

      </div>
    </div>
  )
}
