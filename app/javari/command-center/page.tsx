// app/javari/command-center/page.tsx
// Javari OS — Command Center
// Restored: Tuesday, March 17, 2026
// Fetches /api/autonomy/status, renders task lifecycle counts + recent tasks.
// Safe-guarded against all undefined access — never renders blank screen.
'use client'

import React, { useEffect, useState, useCallback } from 'react'

// ── Types ─────────────────────────────────────────────────────────────────────
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
  ok:           boolean
  timestamp?:   string
  system?:      SystemInfo
  tasks?:       TaskCounts
  recent_tasks?: RecentTask[]
  error?:       string
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const BADGE: Record<string, string> = {
  pending:     'bg-yellow-100 text-yellow-800 border-yellow-200',
  in_progress: 'bg-blue-100 text-blue-800 border-blue-200',
  retry:       'bg-orange-100 text-orange-800 border-orange-200',
  verifying:   'bg-purple-100 text-purple-800 border-purple-200',
  blocked:     'bg-red-100 text-red-800 border-red-200',
  completed:   'bg-green-100 text-green-800 border-green-200',
  failed:      'bg-red-200 text-red-900 border-red-300',
  // legacy alias — maps silently
  running:     'bg-blue-100 text-blue-800 border-blue-200',
}

function Badge({ status = 'unknown' }: { status?: string }) {
  const cls = BADGE[status] ?? 'bg-gray-100 text-gray-600 border-gray-200'
  // normalise legacy 'running' label for display
  const label = status === 'running' ? 'in_progress' : status
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${cls}`}>
      {label}
    </span>
  )
}

function StatTile({
  label, value, accent,
}: { label: string; value: number; accent: string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 flex flex-col gap-1">
      <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">{label}</span>
      <span className={`text-3xl font-bold ${accent}`}>{value}</span>
    </div>
  )
}

function formatUpdated(raw?: string | number): string {
  if (!raw) return '—'
  try {
    const d = typeof raw === 'number' ? new Date(raw) : new Date(raw)
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  } catch { return '—' }
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export const dynamic = 'force-dynamic'

export default function CommandCenterPage() {
  const [data,    setData]    = useState<StatusPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)
  const [lastAt,  setLastAt]  = useState<string>('')

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/autonomy/status', { cache: 'no-store' })
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

  // ── safe-extract with fallbacks so nothing can crash ──────────────────────
  const sys     = data?.system
  const tasks   = data?.tasks
  const recent  = data?.recent_tasks ?? []

  const budgetPct = sys
    ? Math.min(100, Math.round(100 * (sys.budget_spent ?? 0) / (sys.budget_daily || 1)))
    : 0

  // ── Loading state ──────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600 mx-auto mb-3" />
          <p className="text-gray-500 text-sm">Command Center loading…</p>
        </div>
      </div>
    )
  }

  // ── Error state — never blank ──────────────────────────────────────────────
  if (error && !data) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
        <div className="bg-white rounded-xl border border-red-200 shadow p-8 max-w-md w-full text-center">
          <p className="text-red-600 font-semibold text-lg mb-2">Command Center unavailable</p>
          <p className="text-gray-500 text-sm mb-4">{error}</p>
          <button
            onClick={fetchStatus}
            className="px-5 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 transition"
          >
            Retry
          </button>
        </div>
      </div>
    )
  }

  // ── No data fallback ───────────────────────────────────────────────────────
  if (!data) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-gray-400 text-sm">No data available — retrying…</p>
      </div>
    )
  }

  // ── Main render ────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-6xl mx-auto px-6 py-8 space-y-8">

        {/* Header */}
        <div className="flex items-start justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Command Center</h1>
            <p className="text-sm text-gray-500 mt-1">
              Mode: <span className="font-medium text-blue-700">{sys?.mode ?? '—'}</span>
              {' · '}Phase {sys?.active_phase ?? '—'}
              {lastAt && <span className="ml-2 text-gray-400">· refreshed {lastAt}</span>}
            </p>
          </div>
          <div className="flex gap-2 items-center">
            {error && (
              <span className="text-xs text-orange-600 bg-orange-50 border border-orange-200 rounded px-2 py-1">
                Partial error: {error}
              </span>
            )}
            <button
              onClick={fetchStatus}
              className="px-3 py-1.5 text-sm bg-white hover:bg-gray-100 border border-gray-300 rounded-lg transition"
            >
              ↻ Refresh
            </button>
          </div>
        </div>

        {/* Budget bar */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
          <div className="flex justify-between text-sm mb-2">
            <span className="font-medium text-gray-700">Daily AI Budget</span>
            <span className="text-gray-500">
              ${(sys?.budget_spent ?? 0).toFixed(4)} spent
              {' / '}${(sys?.budget_daily ?? 1).toFixed(2)} daily
              {' — '}{budgetPct}% used
            </span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-3">
            <div
              className={`h-3 rounded-full transition-all duration-700 ${
                budgetPct > 80 ? 'bg-red-500' :
                budgetPct > 50 ? 'bg-yellow-500' : 'bg-green-500'
              }`}
              style={{ width: `${budgetPct}%` }}
            />
          </div>
          <p className="text-xs text-gray-400 mt-1.5">
            ${(sys?.budget_left ?? 0).toFixed(4)} remaining today
          </p>
        </div>

        {/* Task count tiles — full lifecycle */}
        <div>
          <h2 className="text-sm font-semibold text-gray-600 uppercase tracking-wide mb-3">
            Task Lifecycle
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <StatTile label="Pending"      value={tasks?.pending     ?? 0} accent="text-yellow-600" />
            <StatTile label="In Progress"  value={tasks?.in_progress ?? 0} accent="text-blue-600"   />
            <StatTile label="Retry"        value={tasks?.retry       ?? 0} accent="text-orange-600" />
            <StatTile label="Verifying"    value={tasks?.verifying   ?? 0} accent="text-purple-600" />
            <StatTile label="Blocked"      value={tasks?.blocked     ?? 0} accent="text-red-600"    />
            <StatTile label="Completed"    value={tasks?.completed   ?? 0} accent="text-green-600"  />
            <StatTile label="Failed"       value={tasks?.failed      ?? 0} accent="text-red-700"    />
            <StatTile label="Total"        value={tasks?.total       ?? 0} accent="text-gray-700"   />
          </div>
        </div>

        {/* Recent tasks table */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
            <h2 className="font-semibold text-gray-900">
              Recent Tasks
              <span className="ml-2 text-xs font-normal text-gray-400">
                (last {(recent ?? []).length})
              </span>
            </h2>
          </div>

          {(recent ?? []).length === 0 ? (
            <div className="px-5 py-10 text-center text-gray-400 text-sm">
              No tasks recorded yet.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
                  <tr>
                    <th className="px-5 py-3 text-left">Title</th>
                    <th className="px-4 py-3 text-left">Status</th>
                    <th className="px-4 py-3 text-left">Source</th>
                    <th className="px-4 py-3 text-left">Model</th>
                    <th className="px-4 py-3 text-right">Cost</th>
                    <th className="px-4 py-3 text-right">Updated</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {(recent ?? []).map((task, i) => (
                    <tr key={task?.id ?? i} className="hover:bg-gray-50 transition-colors">
                      <td className="px-5 py-3 max-w-xs">
                        <span
                          className="block truncate text-gray-900 font-medium"
                          title={task?.title ?? ''}
                        >
                          {task?.title ?? '—'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <Badge status={task?.status ?? 'unknown'} />
                      </td>
                      <td className="px-4 py-3 text-gray-500 text-xs">
                        {task?.source ?? '—'}
                      </td>
                      <td className="px-4 py-3 text-gray-500 text-xs">
                        {task?.model ?? '—'}
                      </td>
                      <td className="px-4 py-3 text-gray-500 text-xs text-right">
                        {task?.cost != null
                          ? `$${Number(task.cost).toFixed(5)}`
                          : '—'}
                      </td>
                      <td className="px-4 py-3 text-gray-400 text-xs text-right">
                        {formatUpdated(task?.updated_at)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Quick links */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
          {[
            { href: '/command/status',  label: 'Status Dashboard', desc: 'Full autonomy metrics' },
            { href: '/javari/roadmap',  label: 'Roadmap',          desc: 'Phase progress tracker' },
            { href: '/command/history', label: 'History',          desc: 'All autonomy events' },
          ].map(link => (
            <a
              key={link.href}
              href={link.href}
              className="block bg-white rounded-xl border border-gray-200 p-4 hover:shadow-md hover:border-blue-300 transition-all"
            >
              <p className="font-semibold text-gray-900">{link.label}</p>
              <p className="text-gray-500 text-xs mt-0.5">{link.desc}</p>
            </a>
          ))}
        </div>

      </div>
    </div>
  )
}
