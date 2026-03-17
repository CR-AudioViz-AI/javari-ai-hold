// components/command/status/StatusDashboard.tsx
// Javari Command Center — Real-time autonomy status dashboard
// Monday, March 16, 2026
'use client'

import React, { useEffect, useState, useCallback } from 'react'

// ── Types ─────────────────────────────────────────────────────────────────
interface TaskCounts {
  total:       number
  pending:     number
  in_progress: number
  retry:       number
  verifying:   number
  blocked:     number
  completed:   number
  failed:      number
}

interface RecentTask {
  id:           string
  title:        string
  status:       string
  source:       string
  model?:       string
  cost?:        number
  completed_at?: string
  updated_at?:  string
}

interface SystemInfo {
  mode:         string
  active_phase: string
  budget_daily: number
  budget_spent: number
  budget_left:  number
}

interface StatusData {
  ok:           boolean
  timestamp:    string
  system:       SystemInfo
  tasks:        TaskCounts
  recent_tasks: RecentTask[]
}

// ── Status badge ──────────────────────────────────────────────────────────
const STATUS_COLORS: Record<string, string> = {
  pending:     'bg-yellow-100 text-yellow-800',
  in_progress: 'bg-blue-100 text-blue-800',
  retry:       'bg-orange-100 text-orange-800',
  verifying:   'bg-purple-100 text-purple-800',
  blocked:     'bg-red-100 text-red-800',
  completed:   'bg-green-100 text-green-800',
  failed:      'bg-red-200 text-red-900',
  running:     'bg-blue-100 text-blue-800',  // legacy
}

function StatusBadge({ status }: { status: string }) {
  const cls = STATUS_COLORS[status] ?? 'bg-gray-100 text-gray-700'
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${cls}`}>
      {status}
    </span>
  )
}

// ── Stat card ─────────────────────────────────────────────────────────────
function StatCard({ label, value, color }: { label: string; value: number | string; color: string }) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4 shadow-sm">
      <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">{label}</p>
      <p className={`text-2xl font-bold ${color}`}>{value}</p>
    </div>
  )
}

// ── Main dashboard ────────────────────────────────────────────────────────
export function StatusDashboard() {
  const [data,    setData]    = useState<StatusData | null>(null)
  const [error,   setError]   = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null)

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/autonomy/status', { cache: 'no-store' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json()
      setData(json)
      setError(null)
      setLastRefresh(new Date())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load status')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchStatus()
    const interval = setInterval(fetchStatus, 15_000) // refresh every 15s
    return () => clearInterval(interval)
  }, [fetchStatus])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
        <span className="ml-3 text-gray-600">Loading autonomy status…</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-6">
        <p className="text-red-700 font-medium">Failed to load status</p>
        <p className="text-red-600 text-sm mt-1">{error}</p>
        <button
          onClick={fetchStatus}
          className="mt-3 px-4 py-2 bg-red-600 text-white rounded text-sm hover:bg-red-700"
        >
          Retry
        </button>
      </div>
    )
  }

  if (!data) return null

  const { system, tasks, recent_tasks = [] } = data

  // Budget percentage
  const budgetPct = Math.min(100, Math.round((system.budget_spent / system.budget_daily) * 100))

  return (
    <div className="space-y-6">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Autonomy Status</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Mode: <span className="font-medium text-blue-700">{system.mode}</span>
            {' · '}Phase {system.active_phase}
            {lastRefresh && (
              <span className="ml-2 text-gray-400">
                Updated {lastRefresh.toLocaleTimeString()}
              </span>
            )}
          </p>
        </div>
        <button
          onClick={fetchStatus}
          className="px-3 py-1.5 text-sm bg-gray-100 hover:bg-gray-200 rounded border border-gray-300 transition"
        >
          ↻ Refresh
        </button>
      </div>

      {/* Budget bar */}
      <div className="bg-white rounded-lg border border-gray-200 p-4 shadow-sm">
        <div className="flex justify-between text-sm mb-2">
          <span className="font-medium text-gray-700">Daily AI Budget</span>
          <span className="text-gray-600">
            ${system.budget_spent.toFixed(4)} / ${system.budget_daily.toFixed(2)}
            {' '}({budgetPct}% used)
          </span>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-2.5">
          <div
            className={`h-2.5 rounded-full transition-all ${
              budgetPct > 80 ? 'bg-red-500' : budgetPct > 50 ? 'bg-yellow-500' : 'bg-green-500'
            }`}
            style={{ width: `${budgetPct}%` }}
          />
        </div>
      </div>

      {/* Task counts grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <StatCard label="Pending"     value={tasks?.pending ?? 0}     color="text-yellow-600" />
        <StatCard label="In Progress" value={tasks?.in_progress ?? 0} color="text-blue-600"   />
        <StatCard label="Retry"       value={tasks?.retry ?? 0}       color="text-orange-600" />
        <StatCard label="Completed"   value={tasks?.completed ?? 0}   color="text-green-600"  />
        <StatCard label="Verifying"   value={tasks?.verifying ?? 0}   color="text-purple-600" />
        <StatCard label="Blocked"     value={tasks?.blocked ?? 0}     color="text-red-600"    />
        <StatCard label="Failed"      value={tasks?.failed ?? 0}      color="text-red-700"    />
        <StatCard label="Total"       value={tasks?.total ?? 0}       color="text-gray-700"   />
      </div>

      {/* Recent tasks table */}
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100">
          <h2 className="font-semibold text-gray-900">Recent Tasks (Last 10)</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
              <tr>
                <th className="px-4 py-2 text-left">Title</th>
                <th className="px-4 py-2 text-left">Status</th>
                <th className="px-4 py-2 text-left">Source</th>
                <th className="px-4 py-2 text-left">Model</th>
                <th className="px-4 py-2 text-left">Cost</th>
                <th className="px-4 py-2 text-left">Updated</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {(recent_tasks ?? []).length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-gray-400">
                    No tasks yet
                  </td>
                </tr>
              ) : (
                (recent_tasks ?? []).map((task) => (
                  <tr key={task?.id ?? Math.random()} className="hover:bg-gray-50">
                    <td className="px-4 py-2 max-w-xs truncate text-gray-900" title={task?.title ?? ''}>
                      {task?.title ?? '—'}
                    </td>
                    <td className="px-4 py-2">
                      <StatusBadge status={task?.status ?? 'unknown'} />
                    </td>
                    <td className="px-4 py-2 text-gray-500 text-xs">{task?.source ?? '—'}</td>
                    <td className="px-4 py-2 text-gray-500 text-xs">{task?.model ?? '—'}</td>
                    <td className="px-4 py-2 text-gray-500 text-xs">
                      {task?.cost != null ? `$${Number(task.cost).toFixed(5)}` : '—'}
                    </td>
                    <td className="px-4 py-2 text-gray-400 text-xs">
                      {task?.updated_at
                        ? new Date(task.updated_at).toLocaleTimeString()
                        : '—'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

export default StatusDashboard
