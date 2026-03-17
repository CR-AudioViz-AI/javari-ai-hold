// app/javari/page.tsx
// Javari OS — Primary Interface v2
// TRUE 2×2 QUADRANT: grid-template-columns: 1fr 1fr; grid-template-rows: 1fr 1fr
// Each quadrant = exactly 50% width × 50% height. No dominant panel.
// Design: SCIF terminal / NORAD ops floor — deep black, glowing separators, phosphor status
// Tuesday, March 17, 2026
'use client'

import {
  useState, useRef, useEffect, useCallback
} from 'react'
import { Send, Zap, ChevronDown, RotateCcw } from 'lucide-react'

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────
type Mode       = 'single' | 'council'
type AvState    = 'idle' | 'thinking' | 'responding' | 'executing'
type MsgRole    = 'user' | 'assistant' | 'system' | 'agent'

interface Msg {
  id:      string
  role:    MsgRole
  content: string
  agent?:  'planner' | 'builder' | 'validator'
  model?:  string
  tier?:   string
  ts:      number
  error?:  boolean
}

interface EnsembleStep {
  role:    string
  model:   string
  tier:    string
  content: string
  cost:    number
}

interface ExecRow {
  id:       string
  title:    string
  module:   string
  model:    string
  status:   string
  verified: boolean
  cost:     number
  ts:       number
}

interface SysStatus {
  total:    number
  completed:number
  verified: number
  pending:  number
  phase:    number
  mode:     string
  pct:      number
  budget:   number
}

// ─────────────────────────────────────────────────────────────────────────────
// Agent definitions
// ─────────────────────────────────────────────────────────────────────────────
const AGENT_CFG = {
  planner:   { label: 'ARCHITECT',  glyph: '◈', hue: '#a855f7' },
  builder:   { label: 'BUILDER',    glyph: '◉', hue: '#3b82f6' },
  validator: { label: 'ANALYST',    glyph: '◎', hue: '#10b981' },
} as const

// ─────────────────────────────────────────────────────────────────────────────
// Avatar: pure CSS animated, state-driven
// ─────────────────────────────────────────────────────────────────────────────
function Avatar({ state }: { state: AvState }) {
  const rings: Record<AvState, { outer: string; mid: string; core: string; dot: string }> = {
    idle:       { outer: 'border-zinc-800',          mid: 'border-zinc-800',          core: 'bg-zinc-900',     dot: 'opacity-0' },
    thinking:   { outer: 'border-violet-500/50',     mid: 'border-violet-700/40 av-spin', core: 'bg-violet-950/80', dot: 'opacity-100 bg-violet-400 av-blink' },
    responding: { outer: 'border-violet-400/70',     mid: 'border-violet-600/50',     core: 'bg-violet-900/70', dot: 'opacity-100 bg-violet-300' },
    executing:  { outer: 'border-amber-500/60 av-blink', mid: 'border-amber-600/40', core: 'bg-amber-950/60',  dot: 'opacity-100 bg-amber-400 av-blink' },
  }
  const r = rings[state]

  return (
    <div className="flex flex-col items-center gap-4 select-none">
      {/* Rings */}
      <div className="relative w-28 h-28">
        {/* Outer ring */}
        <div className={`absolute inset-0 rounded-full border-2 transition-all duration-500 ${r.outer}`} />
        {/* Middle ring */}
        <div className={`absolute inset-4 rounded-full border transition-all duration-700 ${r.mid}`} />
        {/* Core */}
        <div className={`absolute inset-8 rounded-full flex items-center justify-center transition-all duration-300 ${r.core}`}>
          <Zap className={`w-6 h-6 transition-colors duration-300 ${
            state === 'idle'       ? 'text-zinc-700'              :
            state === 'thinking'   ? 'text-violet-400 av-blink'   :
            state === 'responding' ? 'text-violet-300'             :
                                     'text-amber-400 av-blink'
          }`} />
        </div>
        {/* Orbit dot top */}
        <div className={`absolute -top-1 left-1/2 -translate-x-1/2 w-2 h-2 rounded-full transition-all duration-300 ${r.dot}`} />
        {/* Orbit dot right */}
        <div className={`absolute top-1/2 -right-1 -translate-y-1/2 w-1.5 h-1.5 rounded-full transition-all duration-300 ${r.dot}`}
          style={{ animationDelay: '0.4s' }} />
        {/* Orbit dot bottom */}
        <div className={`absolute -bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full transition-all duration-300 ${r.dot}`}
          style={{ animationDelay: '0.8s' }} />
      </div>

      {/* Name */}
      <div className="text-center space-y-1">
        <p className="font-mono text-base tracking-[0.3em] text-zinc-200 uppercase">Javari</p>
        <p className={`font-mono text-xs tracking-[0.25em] transition-colors duration-300 ${
          state === 'idle'       ? 'text-zinc-700'             :
          state === 'thinking'   ? 'text-violet-500 av-blink'  :
          state === 'responding' ? 'text-violet-400'            :
                                   'text-amber-500 av-blink'
        }`}>{state.toUpperCase()}</p>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Quadrant wrapper — enforces equal sizing via CSS, adds glow
// ─────────────────────────────────────────────────────────────────────────────
function Q({
  id, label, tag, glow = 'zinc', children,
}: {
  id: string; label: string; tag?: string; glow?: 'violet' | 'blue' | 'amber' | 'emerald' | 'zinc'
  children: React.ReactNode
}) {
  const glowMap = {
    violet:  'shadow-[inset_0_0_40px_rgba(139,92,246,0.06)] border-violet-900/40',
    blue:    'shadow-[inset_0_0_40px_rgba(59,130,246,0.05)] border-blue-900/30',
    amber:   'shadow-[inset_0_0_40px_rgba(245,158,11,0.05)] border-amber-900/30',
    emerald: 'shadow-[inset_0_0_40px_rgba(16,185,129,0.05)] border-emerald-900/30',
    zinc:    'border-zinc-800/50',
  }
  const labelMap = {
    violet:  'text-violet-500',
    blue:    'text-blue-500',
    amber:   'text-amber-500',
    emerald: 'text-emerald-500',
    zinc:    'text-zinc-600',
  }

  return (
    <div
      id={id}
      className={`relative flex flex-col border bg-black/40 overflow-hidden ${glowMap[glow]}`}
    >
      {/* Corner label */}
      <div className="flex-shrink-0 flex items-center gap-2 px-4 py-2 border-b border-zinc-800/40">
        <span className={`font-mono text-[9px] tracking-[0.3em] uppercase ${labelMap[glow]}`}>{label}</span>
        {tag && <span className="font-mono text-[9px] text-zinc-700 ml-auto">{tag}</span>}
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {children}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Main page
// ─────────────────────────────────────────────────────────────────────────────
export const dynamic = 'force-dynamic'

export default function JavariOSPage() {
  // State
  const [mode,        setMode]        = useState<Mode>('single')
  const [avState,     setAvState]     = useState<AvState>('idle')
  const [messages,    setMessages]    = useState<Msg[]>([
    { id: '0', role: 'system', content: 'JAVARI OS — online', ts: Date.now() }
  ])
  const [input,       setInput]       = useState('')
  const [loading,     setLoading]     = useState(false)
  const [modeOpen,    setModeOpen]    = useState(false)
  const [ensemble,    setEnsemble]    = useState<EnsembleStep[]>([])
  const [execRows,    setExecRows]    = useState<ExecRow[]>([])
  const [sysStatus,   setSysStatus]   = useState<SysStatus | null>(null)
  const [execPulse,   setExecPulse]   = useState(false)

  const bottomRef  = useRef<HTMLDivElement>(null)
  const textRef    = useRef<HTMLTextAreaElement>(null)

  // Auto-scroll chat
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages, loading])

  // Auto-resize textarea
  useEffect(() => {
    const el = textRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 120) + 'px'
  }, [input])

  // Poll status every 15s
  const loadStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/autonomy/status', { cache: 'no-store' })
      if (!res.ok) return
      const data = await res.json()
      if (!data.ok) return
      const c = data.canonical ?? {}
      setSysStatus({
        total:     c.total     ?? 275,
        completed: c.completed ?? 0,
        verified:  c.verified  ?? 0,
        pending:   c.pending   ?? 0,
        phase:     data.system?.active_phase ?? 2,
        mode:      data.system?.mode         ?? 'BUILD',
        pct:       c.pct_verified            ?? 0,
        budget:    data.system?.budget_left  ?? 0,
      })
      // Recent executions
      const recent: Array<Record<string,unknown>> = data.recent_executions ?? []
      if (recent.length) {
        setExecRows(recent.slice(0, 8).map((e, i) => ({
          id:       String(e.id ?? i),
          title:    String(e.id ?? 'Task').split(':').slice(-1)[0].replace(/-/g, ' '),
          module:   String(e.type ?? '—'),
          model:    String(e.model ?? ''),
          status:   String(e.status ?? 'unknown'),
          verified: Boolean(e.verification),
          cost:     Number(e.cost ?? 0),
          ts:       Date.now() - i * 30000,
        })))
      }
    } catch { /* non-fatal */ }
  }, [])

  useEffect(() => {
    loadStatus()
    const t = setInterval(loadStatus, 15_000)
    return () => clearInterval(t)
  }, [loadStatus])

  // ── Send message ───────────────────────────────────────────────────────────
  const send = useCallback(async (override?: string) => {
    const content = (override ?? input).trim()
    if (!content || loading) return
    setMessages(m => [...m, { id: Date.now().toString(), role: 'user', content, ts: Date.now() }])
    setInput('')
    setLoading(true)
    setAvState('thinking')
    setEnsemble([])

    // Fire-and-forget learning log
    fetch('/api/javari/learning/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer javari-cron-2025-phase2-autonomous' },
      body: JSON.stringify({
        records: [{ task_id: `chat-${Date.now()}`, task_title: content.slice(0, 100), task_source: 'javari_ui', task_type: 'chat', status: 'completed', canonical_valid: false, phase_id: '', cycle_id: `ui-${Date.now()}` }],
      }),
    }).catch(() => {})

    try {
      if (mode === 'council') {
        const res  = await fetch('/api/javari/team', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: content }),
        })
        const data = await res.json()
        if (data.error) throw new Error(data.error)

        // Populate agent panel
        if (data.ensemble?.length) setEnsemble(data.ensemble)

        // Show each ensemble step as labeled agent message
        if (data.ensemble?.length) {
          const agentMsgs: Msg[] = data.ensemble.map((step: EnsembleStep) => ({
            id:      Date.now().toString() + Math.random(),
            role:    'agent' as const,
            agent:   step.role as 'planner' | 'builder' | 'validator',
            content: step.content,
            model:   step.model,
            tier:    step.tier,
            ts:      Date.now(),
          }))
          setMessages(m => [...m, ...agentMsgs])
        }

        // Final content from validator
        if (data.content) {
          setAvState('responding')
          setMessages(m => [...m, {
            id: Date.now().toString(), role: 'assistant',
            content: data.content, model: data.model, ts: Date.now(),
          }])
        }
      } else {
        const res  = await fetch('/api/javari/chat', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: content }),
        })
        const data = await res.json()
        if (data.error || data.blocked) throw new Error(data.error ?? 'Blocked')
        setAvState('responding')
        setMessages(m => [...m, {
          id: Date.now().toString(), role: 'assistant',
          content: data.content, model: data.model, tier: data.tier, ts: Date.now(),
        }])
      }
    } catch (err: unknown) {
      setMessages(m => [...m, {
        id: Date.now().toString(), role: 'assistant', error: true,
        content: err instanceof Error ? err.message : String(err), ts: Date.now(),
      }])
    } finally {
      setLoading(false)
      setTimeout(() => setAvState('idle'), 2000)
    }
  }, [input, loading, mode])

  // ── Run Loop ───────────────────────────────────────────────────────────────
  const runLoop = useCallback(async () => {
    if (avState === 'executing') return
    setAvState('executing')
    setExecPulse(true)
    try {
      const res  = await fetch('/api/autonomy/loop')
      const data = await res.json()
      if (data.executed?.length) {
        const newRows: ExecRow[] = data.executed.map((e: Record<string,unknown>, i: number) => ({
          id:       String(e.id ?? i),
          title:    String(e.title ?? 'Task'),
          module:   String(e.module ?? e.task_type ?? ''),
          model:    String(e.model ?? ''),
          status:   String(e.status ?? 'completed'),
          verified: Boolean(e.verified),
          cost:     Number(e.cost ?? 0),
          ts:       Date.now(),
        }))
        setExecRows(prev => [...newRows, ...prev].slice(0, 20))
        setMessages(m => [...m, {
          id: Date.now().toString(), role: 'system',
          content: `⚡ Loop: ${data.completed_verified ?? data.tasks_run ?? 0} tasks executed — ${data.daily_spend}`,
          ts: Date.now(),
        }])
        await loadStatus()
      }
    } catch { /* non-fatal */ }
    finally {
      setTimeout(() => { setAvState('idle'); setExecPulse(false) }, 3000)
    }
  }, [avState, loadStatus])

  const clearChat = useCallback(() => {
    setMessages([{ id: Date.now().toString(), role: 'system', content: 'Session cleared.', ts: Date.now() }])
    setEnsemble([])
  }, [])

  const PROMPTS = ['Write a business plan', 'Create brand content', 'Analyze my strategy', 'Build a campaign', 'Draft an email', 'Explain this concept']
  const hasChat = messages.filter(m => m.role !== 'system').length > 0

  return (
    <>
      {/* ── Keyframes ──────────────────────────────────────────────────── */}
      <style>{`
        @keyframes av-blink { 0%,100%{opacity:1} 50%{opacity:.25} }
        @keyframes av-spin  { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
        .av-blink { animation: av-blink 1.4s ease-in-out infinite }
        .av-spin  { animation: av-spin  3s linear infinite }
        :root {
          --sep: #27272a;
          --sep-glow: rgba(139,92,246,0.15);
        }
      `}</style>

      <div
        className="w-screen h-screen bg-[#050507] text-zinc-200 overflow-hidden flex flex-col"
        onClick={() => setModeOpen(false)}
      >
        {/* Scanlines */}
        <div className="pointer-events-none fixed inset-0 z-0"
          style={{ backgroundImage: 'repeating-linear-gradient(0deg,transparent,transparent 3px,rgba(0,0,0,0.12) 3px,rgba(0,0,0,0.12) 4px)' }} />

        {/* ── HEADER ───────────────────────────────────────────────────── */}
        <header className="flex-shrink-0 relative z-20 flex items-center px-5 py-2 border-b border-zinc-800/60 bg-black/60 backdrop-blur-sm gap-4">
          {/* Logo + title */}
          <div className="flex items-center gap-2.5 flex-shrink-0">
            <div className="w-7 h-7 rounded bg-gradient-to-br from-violet-600 to-violet-900 flex items-center justify-center">
              <Zap className="w-4 h-4 text-white" />
            </div>
            <span className="font-mono text-sm tracking-[0.3em] text-zinc-200 uppercase">JAVARI OS</span>
          </div>

          <div className="w-px h-5 bg-zinc-800" />

          {/* Mode indicator */}
          <div className="relative flex-shrink-0" onClick={e => e.stopPropagation()}>
            <button
              onClick={() => setModeOpen(v => !v)}
              className="flex items-center gap-2 px-3 py-1.5 rounded border border-zinc-800 bg-zinc-900/50 hover:border-zinc-700 transition-all font-mono text-[10px] tracking-widest uppercase"
            >
              <span className={mode === 'single' ? 'text-blue-400' : 'text-violet-400'}>
                {mode === 'single' ? '◉ SINGLE AI' : '◈ AI COUNCIL'}
              </span>
              <ChevronDown className={`w-3 h-3 text-zinc-600 transition-transform ${modeOpen ? 'rotate-180' : ''}`} />
            </button>
            {modeOpen && (
              <div className="absolute top-full left-0 mt-1 w-56 bg-zinc-950 border border-zinc-800 rounded-xl shadow-2xl z-50">
                {([
                  { id: 'single'  as Mode, label: 'SINGLE AI',  sub: 'Cost-optimised — fastest',    dot: 'bg-blue-400' },
                  { id: 'council' as Mode, label: 'AI COUNCIL', sub: 'Architect + Builder + Analyst', dot: 'bg-violet-400' },
                ] as { id: Mode; label: string; sub: string; dot: string }[]).map(opt => (
                  <button key={opt.id}
                    onClick={() => { setMode(opt.id); setModeOpen(false) }}
                    className={`w-full flex items-start gap-3 px-4 py-3 text-left hover:bg-zinc-900 transition-colors first:rounded-t-xl last:rounded-b-xl ${mode === opt.id ? 'bg-zinc-900/60' : ''}`}>
                    <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 mt-1.5 ${opt.dot}`} />
                    <div>
                      <p className="font-mono text-xs text-zinc-200">{opt.label}</p>
                      <p className="font-mono text-[10px] text-zinc-600 mt-0.5">{opt.sub}</p>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="flex-1" />

          {/* Status pill */}
          {sysStatus && (
            <div className="hidden md:flex items-center gap-3 font-mono text-[10px] text-zinc-600">
              <span className={sysStatus.mode === 'BUILD' ? 'text-blue-600' : 'text-amber-600'}>{sysStatus.mode}</span>
              <span>P{sysStatus.phase}</span>
              <span className="text-emerald-700">{sysStatus.pct}% VERIFIED</span>
            </div>
          )}

          <div className="w-px h-5 bg-zinc-800" />

          <a href="/command-center"
            className="font-mono text-[9px] tracking-[0.2em] uppercase text-zinc-700 hover:text-zinc-500 transition-colors px-2 py-1 border border-zinc-800/60 rounded">
            ⚙ ADMIN
          </a>
        </header>

        {/* ── QUADRANT GRID ─────────────────────────────────────────────── */}
        {/*
          Desktop: strict 2×2 — each cell exactly 1fr × 1fr
          Mobile:  single column, order: chat, agents, exec, avatar
        */}
        <main className="flex-1 min-h-0 relative z-10
          grid gap-px bg-zinc-800/40
          grid-cols-1 grid-rows-[auto_1fr_auto_auto]
          md:grid-cols-2 md:grid-rows-2
        ">

          {/* ── Q1: IDENTITY / AVATAR ─────────────────────── top-left ── */}
          <Q id="q1" label="Q1 · IDENTITY" glow="violet"
            className="order-4 md:order-1">
            <div className="h-full flex flex-col items-center justify-between p-5 py-6">

              {/* Logo mark */}
              <div className="flex flex-col items-center gap-2">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-700 to-violet-950 flex items-center justify-center ring-1 ring-violet-800/60">
                  <Zap className="w-5 h-5 text-violet-300" />
                </div>
                <p className="font-mono text-[10px] tracking-[0.4em] text-zinc-500 uppercase">Javari AI</p>
              </div>

              {/* Avatar */}
              <Avatar state={avState} />

              {/* Status grid */}
              <div className="w-full space-y-2 font-mono">
                {sysStatus ? (
                  <>
                    {[
                      { k: 'PHASE',    v: `${sysStatus.phase}`,                    c: 'text-zinc-300' },
                      { k: 'TASKS',    v: `${sysStatus.completed} / ${sysStatus.total}`, c: 'text-zinc-300' },
                      { k: 'VERIFIED', v: `${sysStatus.pct}%`,                     c: 'text-emerald-500' },
                      { k: 'PENDING',  v: `${sysStatus.pending}`,                  c: 'text-amber-600' },
                      { k: 'BUDGET',   v: `$${sysStatus.budget.toFixed(3)}`,       c: 'text-zinc-500' },
                    ].map(row => (
                      <div key={row.k} className="flex items-center justify-between px-1">
                        <span className="text-[9px] tracking-[0.2em] text-zinc-700">{row.k}</span>
                        <span className={`text-xs font-bold tabular-nums ${row.c}`}>{row.v}</span>
                      </div>
                    ))}
                    {/* Progress bar */}
                    <div className="h-px w-full bg-zinc-800 rounded overflow-hidden mt-1">
                      <div className="h-full bg-gradient-to-r from-violet-700 via-indigo-600 to-emerald-600 transition-all duration-1000"
                        style={{ width: `${sysStatus.pct}%` }} />
                    </div>
                  </>
                ) : (
                  <p className="text-[9px] text-zinc-700 text-center tracking-widest av-blink">CONNECTING…</p>
                )}
              </div>

              {/* Run loop button */}
              <button
                onClick={runLoop}
                disabled={avState === 'executing'}
                className={`w-full py-2 font-mono text-[10px] tracking-[0.25em] uppercase rounded border transition-all ${
                  avState === 'executing'
                    ? 'border-amber-800/50 bg-amber-950/30 text-amber-700 cursor-wait'
                    : 'border-zinc-800 bg-zinc-900/40 text-zinc-600 hover:border-violet-800/60 hover:text-violet-500 hover:bg-violet-950/20'
                }`}>
                {avState === 'executing' ? '⚡ EXECUTING…' : '▶ RUN LOOP'}
              </button>
            </div>
          </Q>

          {/* ── Q2: CHAT ────────────────────────────────────── top-right ── */}
          <Q id="q2" label="Q2 · CHAT INTERFACE" tag={`/${mode.toUpperCase()}`} glow="blue"
            className="order-1 md:order-2 min-h-[50vh] md:min-h-0">
            <div className="h-full flex flex-col">

              {/* Message history */}
              <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 min-h-0">
                {!hasChat && (
                  <div className="h-full flex flex-col items-center justify-center gap-4 text-center select-none">
                    <p className="font-mono text-[10px] tracking-[0.3em] text-zinc-700 uppercase">Ready</p>
                    <div className="flex flex-wrap gap-1.5 justify-center max-w-xs">
                      {PROMPTS.map(p => (
                        <button key={p} onClick={() => send(p)}
                          className="px-2.5 py-1.5 font-mono text-[10px] text-zinc-600 bg-zinc-900/60 border border-zinc-800/60 rounded-md hover:border-blue-800/50 hover:text-blue-400 hover:bg-blue-950/20 transition-all tracking-wider">
                          {p}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {messages.map(msg => {
                  if (msg.role === 'system') {
                    return (
                      <div key={msg.id} className="flex justify-center">
                        <span className="font-mono text-[9px] text-zinc-700 tracking-widest">{msg.content}</span>
                      </div>
                    )
                  }
                  const isUser  = msg.role === 'user'
                  const agentCfg = msg.agent ? AGENT_CFG[msg.agent] : null
                  return (
                    <div key={msg.id} className={`flex gap-2 ${isUser ? 'flex-row-reverse' : ''}`}>
                      {/* Glyph */}
                      <div className="flex-shrink-0 w-6 h-6 mt-0.5 flex items-center justify-center rounded font-mono text-sm"
                        style={{ color: agentCfg?.hue ?? (isUser ? '#71717a' : '#a855f7') }}>
                        {isUser ? '▸' : agentCfg ? agentCfg.glyph : '◉'}
                      </div>
                      <div className={`flex flex-col gap-1 max-w-[82%] ${isUser ? 'items-end' : 'items-start'}`}>
                        {agentCfg && (
                          <span className="font-mono text-[9px] tracking-[0.2em]"
                            style={{ color: agentCfg.hue }}>{agentCfg.label}</span>
                        )}
                        <div className={`px-3 py-2.5 text-sm leading-relaxed whitespace-pre-wrap break-words rounded-lg ${
                          isUser
                            ? 'bg-zinc-800 text-zinc-100 rounded-tr-none'
                            : msg.error
                              ? 'bg-red-950/40 text-red-400 border border-red-900/40 rounded-tl-none'
                              : agentCfg
                                ? 'bg-zinc-900/60 text-zinc-200 border border-zinc-800/40 rounded-tl-none'
                                : 'bg-zinc-900/60 text-zinc-100 border border-zinc-800/30 rounded-tl-none'
                        }`}>
                          {msg.content}
                        </div>
                        {msg.model && (
                          <span className="font-mono text-[9px] text-zinc-700 px-1">{msg.model.split('-').slice(-2).join('-')}</span>
                        )}
                      </div>
                    </div>
                  )
                })}

                {/* Typing indicator */}
                {loading && (
                  <div className="flex gap-2">
                    <div className="w-6 h-6 flex items-center justify-center text-violet-500 font-mono">◉</div>
                    <div className="bg-zinc-900/60 border border-zinc-800/30 rounded-lg rounded-tl-none px-3 py-2 flex items-center gap-1.5">
                      {[0,1,2].map(i => (
                        <div key={i} className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-bounce"
                          style={{ animationDelay: `${i * 0.15}s` }} />
                      ))}
                      <span className="font-mono text-[9px] text-zinc-700 ml-1">
                        {mode === 'council' ? 'COUNCIL…' : 'JAVARI…'}
                      </span>
                    </div>
                  </div>
                )}
                <div ref={bottomRef} />
              </div>

              {/* Input bar */}
              <div className="flex-shrink-0 border-t border-zinc-800/40 px-3 py-3">
                <div className="flex items-end gap-2 bg-zinc-900/40 border border-zinc-800/60 hover:border-blue-800/40 focus-within:border-blue-700/40 rounded-lg px-3 py-2 transition-all">
                  <textarea
                    ref={textRef}
                    rows={1}
                    value={input}
                    onChange={e => setInput(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
                    placeholder={mode === 'council' ? 'Consult the AI Council…' : 'Message Javari…'}
                    className="flex-1 bg-transparent resize-none text-sm text-zinc-200 placeholder-zinc-700 outline-none leading-relaxed font-mono min-h-[18px] max-h-[120px]"
                  />
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    {hasChat && (
                      <button onClick={clearChat}
                        className="w-6 h-6 rounded flex items-center justify-center text-zinc-700 hover:text-zinc-500 transition-colors">
                        <RotateCcw className="w-3 h-3" />
                      </button>
                    )}
                    <button onClick={() => send()} disabled={!input.trim() || loading}
                      className="w-7 h-7 rounded bg-blue-700 hover:bg-blue-600 disabled:opacity-20 disabled:cursor-not-allowed flex items-center justify-center transition-colors">
                      <Send className="w-3.5 h-3.5 text-white" />
                    </button>
                  </div>
                </div>
                <p className="font-mono text-[9px] text-zinc-800 mt-1.5 text-center tracking-widest">ENTER TO SEND — SHIFT+ENTER FOR NEWLINE</p>
              </div>
            </div>
          </Q>

          {/* ── Q3: AI AGENTS ─────────────────────────────── bottom-left ── */}
          <Q id="q3" label="Q3 · AI AGENTS" tag="ARCHITECT / BUILDER / ANALYST" glow="emerald"
            className="order-2 md:order-3">
            <div className="h-full overflow-y-auto p-4 space-y-3">
              {Object.entries(AGENT_CFG).map(([key, cfg]) => {
                const step    = ensemble.find(s => s.role === key)
                const waiting = loading && mode === 'council'
                return (
                  <div key={key}
                    style={{ borderColor: step ? cfg.hue + '40' : waiting ? cfg.hue + '18' : undefined }}
                    className={`p-3 rounded-lg border transition-all duration-300 ${
                      step    ? 'bg-zinc-900/60'                      :
                      waiting ? 'bg-zinc-900/20 av-blink border-dashed' :
                                'border-zinc-800/30 bg-transparent'
                    }`}>
                    {/* Agent header */}
                    <div className="flex items-center gap-2 mb-2">
                      <span className="font-mono text-base leading-none" style={{ color: cfg.hue }}>{cfg.glyph}</span>
                      <span className="font-mono text-[10px] tracking-[0.25em] uppercase" style={{ color: step ? cfg.hue : '#52525b' }}>{cfg.label}</span>
                      {step && (
                        <span className="font-mono text-[9px] text-zinc-700 ml-auto">
                          {step.model.split('-').slice(-2).join('-')} · ${step.cost.toFixed(5)}
                        </span>
                      )}
                      {waiting && !step && (
                        <span className="font-mono text-[9px] ml-auto" style={{ color: cfg.hue + '80' }}>WAITING…</span>
                      )}
                      {/* Active status dot */}
                      <div className={`w-1.5 h-1.5 rounded-full ml-1 ${step ? 'bg-emerald-500' : waiting ? 'av-blink' : 'bg-zinc-800'}`}
                        style={waiting && !step ? { backgroundColor: cfg.hue, opacity: 0.5 } : undefined} />
                    </div>
                    {/* Content */}
                    {step ? (
                      <p className="text-xs text-zinc-400 leading-relaxed line-clamp-4 font-mono">{step.content}</p>
                    ) : (
                      <p className="font-mono text-[9px] text-zinc-700 tracking-wider">
                        {key === 'planner'   ? 'Breaks down tasks into executable steps' :
                         key === 'builder'   ? 'Implements the plan fully'                :
                                              'Reviews and validates output'}
                      </p>
                    )}
                    {/* Tier badge */}
                    {step?.tier && (
                      <div className="mt-2">
                        <span className={`font-mono text-[9px] px-1.5 py-0.5 rounded ${
                          step.tier === 'free' ? 'text-emerald-700 bg-emerald-950/40' :
                          step.tier === 'low'  ? 'text-blue-700 bg-blue-950/40'       :
                                                  'text-amber-700 bg-amber-950/40'
                        }`}>{step.tier.toUpperCase()}</span>
                      </div>
                    )}
                  </div>
                )
              })}
              {mode === 'single' && (
                <p className="font-mono text-[9px] text-zinc-800 text-center py-2 tracking-widest">SWITCH TO COUNCIL TO ACTIVATE AGENTS</p>
              )}
            </div>
          </Q>

          {/* ── Q4: EXECUTION ─────────────────────────────── bottom-right ── */}
          <Q id="q4" label="Q4 · EXECUTION STREAM" tag="LIVE" glow="amber"
            className="order-3 md:order-4">
            <div className="h-full overflow-y-auto p-3 space-y-1.5">
              {execRows.length === 0 && (
                <div className="h-full flex flex-col items-center justify-center gap-2 text-center py-4">
                  <div className={`w-2 h-2 rounded-full bg-zinc-800 mx-auto ${execPulse ? 'bg-amber-500 av-blink' : ''}`} />
                  <p className="font-mono text-[9px] text-zinc-700 tracking-widest">NO ACTIVITY</p>
                  <p className="font-mono text-[9px] text-zinc-800">USE RUN LOOP OR WAIT FOR CRON</p>
                </div>
              )}

              {execRows.map((row, i) => {
                const isNew = execPulse && i < 5 && row.ts > Date.now() - 10000
                return (
                  <div key={row.id + row.ts}
                    className={`p-2 rounded border transition-all duration-500 ${
                      isNew
                        ? 'border-amber-800/50 bg-amber-950/20'
                        : 'border-zinc-800/25 bg-zinc-900/20'
                    }`}>
                    <div className="flex items-start gap-2">
                      {/* Status glyph */}
                      <span className={`font-mono text-xs flex-shrink-0 mt-px ${
                        row.verified                   ? 'text-emerald-500' :
                        row.status === 'completed'     ? 'text-blue-500'    :
                        row.status === 'failed'        ? 'text-red-500'     :
                                                         'text-amber-600'
                      }`}>
                        {row.verified ? '✓' : row.status === 'failed' ? '✗' : row.status === 'completed' ? '●' : '○'}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="font-mono text-[10px] text-zinc-300 truncate capitalize leading-tight">{row.title}</p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="font-mono text-[9px] text-zinc-700">{row.module}</span>
                          {row.model && <span className="font-mono text-[9px] text-zinc-800">{row.model.split('-').slice(-1)}</span>}
                          {row.cost > 0 && (
                            <span className="font-mono text-[9px] text-zinc-800 ml-auto tabular-nums">${row.cost.toFixed(5)}</span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </Q>

        </main>
      </div>
    </>
  )
}
