// app/javari/page.tsx
// Javari AI — Autonomy Overview Page
// Monday, March 16, 2026
'use client'

import React, { useEffect, useState } from 'react'

interface LoopData {
  status:      string
  mode:        string
  tasks_run:   number
  executed:    Array<{ roadmap_task_id: string; title: string; task_type?: string; model?: string; cost?: number; error?: string }>
  daily_spend: string
  budget_left: string
  cycle_ms:    number
  timestamp:   string
}

export const dynamic = 'force-dynamic'

export default function JavariPage() {
  const [loop,    setLoop]    = useState<LoopData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState<string | null>(null)

  const runLoop = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/autonomy/loop', { cache: 'no-store' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setLoop(await res.json())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Loop call failed')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { runLoop() }, [])

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Javari AI</h1>
          <p className="text-gray-500 text-sm mt-0.5">Autonomous execution engine</p>
        </div>
        <button
          onClick={runLoop}
          disabled={loading}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 text-sm font-medium"
        >
          {loading ? 'Running…' : '▶ Trigger Loop'}
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700 text-sm">{error}</div>
      )}

      {loop && (
        <div className="space-y-4">
          {/* Status bar */}
          <div className="bg-white rounded-lg border border-gray-200 p-4 shadow-sm flex flex-wrap gap-6">
            <div>
              <p className="text-xs text-gray-500 uppercase">Status</p>
              <p className={`font-semibold ${loop.status === 'executed' ? 'text-green-600' : 'text-yellow-600'}`}>
                {loop.status}
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-500 uppercase">Mode</p>
              <p className="font-semibold text-blue-600">{loop.mode}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500 uppercase">Tasks Run</p>
              <p className="font-semibold text-gray-900">{loop.tasks_run}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500 uppercase">Daily Spend</p>
              <p className="font-semibold text-gray-900">{loop.daily_spend}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500 uppercase">Budget Left</p>
              <p className="font-semibold text-green-600">{loop.budget_left}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500 uppercase">Cycle</p>
              <p className="font-semibold text-gray-700">{(loop.cycle_ms / 1000).toFixed(1)}s</p>
            </div>
          </div>

          {/* Executed tasks */}
          {(loop.executed ?? []).length > 0 && (
            <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-100 font-semibold text-gray-900 text-sm">
                Executed this cycle ({loop.executed.length})
              </div>
              <ul className="divide-y divide-gray-100">
                {(loop.executed ?? []).map((t, i) => (
                  <li key={t?.roadmap_task_id ?? i} className="px-4 py-3">
                    <p className="text-sm font-medium text-gray-900">{t?.title ?? '—'}</p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {t?.task_type} · {t?.model}
                      {t?.cost != null ? ` · $${Number(t.cost).toFixed(5)}` : ''}
                      {t?.error ? ` · ⚠ ${t.error}` : ''}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {loop.tasks_run === 0 && (
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 text-yellow-800 text-sm">
              Loop idle — all queues empty or budget reached.
            </div>
          )}

          <p className="text-xs text-gray-400 text-right">
            Last run: {new Date(loop.timestamp).toLocaleString()}
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
        <a href="/javari/roadmap"       className="block bg-white rounded-lg border border-gray-200 p-4 hover:shadow-md transition-shadow">
          <p className="font-semibold text-gray-900">Roadmap</p>
          <p className="text-gray-500 text-xs mt-0.5">Track phase progress</p>
        </a>
        <a href="/command/status"       className="block bg-white rounded-lg border border-gray-200 p-4 hover:shadow-md transition-shadow">
          <p className="font-semibold text-gray-900">Status Dashboard</p>
          <p className="text-gray-500 text-xs mt-0.5">Real-time task metrics</p>
        </a>
        <a href="/command/history"      className="block bg-white rounded-lg border border-gray-200 p-4 hover:shadow-md transition-shadow">
          <p className="font-semibold text-gray-900">History</p>
          <p className="text-gray-500 text-xs mt-0.5">All autonomy events</p>
        </a>
      </div>
    </div>
  )
}
