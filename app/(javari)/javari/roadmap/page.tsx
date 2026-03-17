// app/javari/roadmap/page.tsx
// Javari AI — Roadmap progress page
// Monday, March 16, 2026
'use client'

import React, { useEffect, useState } from 'react'

interface RoadmapItem {
  id:         string
  phase:      number
  milestone:  string
  item_id:    string
  status:     string
  notes?:     string
  updated_at: string
}

export const dynamic = 'force-dynamic'

const STATUS_COLORS: Record<string, string> = {
  complete:    'text-green-600',
  in_progress: 'text-blue-600',
  pending:     'text-yellow-600',
  blocked:     'text-red-600',
}

const STATUS_ICONS: Record<string, string> = {
  complete:    '✅',
  in_progress: '🔄',
  pending:     '○',
  blocked:     '🚫',
}

export default function RoadmapPage() {
  const [items,   setItems]   = useState<RoadmapItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)

  useEffect(() => {
    const supabaseUrl  = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseAnon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

    if (!supabaseUrl || !supabaseAnon) {
      // Fetch via internal API if env vars not exposed client-side
      fetch('/api/javari/roadmap', { cache: 'no-store' })
        .then(r => r.json())
        .then(d => {
          setItems(d.db_progress ?? [])
          setLoading(false)
        })
        .catch(e => { setError(e.message); setLoading(false) })
      return
    }

    fetch(`${supabaseUrl}/rest/v1/javari_roadmap_progress?select=*&order=phase,item_id`, {
      headers: { apikey: supabaseAnon, Authorization: `Bearer ${supabaseAnon}` }
    })
      .then(r => r.json())
      .then(d => { setItems(Array.isArray(d) ? d : []); setLoading(false) })
      .catch(e => { setError(e.message); setLoading(false) })
  }, [])

  const phases = [...new Set((items ?? []).map(i => i?.phase))].sort((a, b) => a - b)
  const phaseNames: Record<number, string> = {
    0: 'Protection',
    1: 'Core Infrastructure',
    2: 'Module Factory',
    3: 'CRAIverse',
  }

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Roadmap Progress</h1>
        <p className="text-gray-500 text-sm mt-0.5">Master Roadmap v2.0 — {(items ?? []).length} milestones tracked</p>
      </div>

      {loading && (
        <div className="flex items-center gap-3 text-gray-500">
          <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-600" />
          Loading roadmap…
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700 text-sm">{error}</div>
      )}

      {!loading && !error && phases.map(phase => {
        const phaseItems = (items ?? []).filter(i => i?.phase === phase)
        const done  = phaseItems.filter(i => i?.status === 'complete').length
        const total = phaseItems.length
        const pct   = total > 0 ? Math.round(100 * done / total) : 0

        return (
          <div key={phase} className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
            <div className="px-4 py-3 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
              <div>
                <span className="font-semibold text-gray-900">Phase {phase}</span>
                <span className="ml-2 text-gray-500 text-sm">{phaseNames[phase] ?? ''}</span>
              </div>
              <div className="flex items-center gap-3">
                <div className="w-32 bg-gray-200 rounded-full h-2">
                  <div
                    className={`h-2 rounded-full ${pct === 100 ? 'bg-green-500' : pct > 50 ? 'bg-blue-500' : 'bg-yellow-500'}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <span className="text-sm text-gray-600 w-14 text-right">{pct}% ({done}/{total})</span>
              </div>
            </div>
            <ul className="divide-y divide-gray-100">
              {phaseItems.map(item => (
                <li key={item?.item_id ?? item?.id} className="px-4 py-3 flex items-start gap-3">
                  <span className="text-base flex-shrink-0 mt-0.5">
                    {STATUS_ICONS[item?.status] ?? '?'}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{item?.milestone ?? '—'}</p>
                    {item?.notes && (
                      <p className="text-xs text-gray-500 mt-0.5 truncate">{item.notes}</p>
                    )}
                  </div>
                  <span className={`text-xs font-medium flex-shrink-0 ${STATUS_COLORS[item?.status] ?? 'text-gray-500'}`}>
                    {item?.status}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )
      })}
    </div>
  )
}
