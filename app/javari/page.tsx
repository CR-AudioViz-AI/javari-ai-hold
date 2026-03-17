// app/javari/page.tsx
// Javari OS — Primary Interface
// Quadrant layout: Avatar + Status | Chat | Agents | Execution
// Design: Deep Space Operations Center — instrument panels, not chatbot bubbles
// Tuesday, March 17, 2026
'use client'

import { useState, useRef, useEffect, useCallback, Fragment } from 'react'
import { Send, Zap, Cpu, Users, Activity, ChevronDown, RotateCcw, Maximize2, X } from 'lucide-react'

// ── Types ──────────────────────────────────────────────────────────────────────
type ChatMode = 'single' | 'council'
type AgentRole = 'architect' | 'builder' | 'analyst'
type AvatarState = 'idle' | 'thinking' | 'responding' | 'executing'
type MsgRole = 'user' | 'assistant' | 'system' | 'agent'

interface Message {
  id:       string
  role:     MsgRole
  content:  string
  agent?:   AgentRole
  model?:   string
  tier?:    string
  cost?:    number
  ts:       number
  error?:   boolean
}

interface AgentStep {
  role:    string
  model:   string
  tier:    string
  content: string
  cost:    number
}

interface ExecEntry {
  id:      string
  title:   string
  phase:   number
  module:  string
  model?:  string
  cost?:   number
  status:  string
  verified?: boolean
  ts:      number
}

interface SystemStatus {
  total:     number
  completed: number
  verified:  number
  pending:   number
  phase:     number
  mode:      string
  pct:       number
  budget_left?: number
}

// ── Agent config ───────────────────────────────────────────────────────────────
const AGENTS: Record<AgentRole, { label: string; glyph: string; color: string; dim: string }> = {
  architect: { label: 'Architect', glyph: '◈', color: 'text-violet-400', dim: 'text-violet-600' },
  builder:   { label: 'Builder',   glyph: '◉', color: 'text-blue-400',   dim: 'text-blue-600' },
  analyst:   { label: 'Analyst',   glyph: '◎', color: 'text-emerald-400',dim: 'text-emerald-600' },
}

// ── Avatar component ───────────────────────────────────────────────────────────
function JavariAvatar({ state }: { state: AvatarState }) {
  return (
    <div className="flex flex-col items-center gap-3 select-none">
      {/* Geometric pulse avatar */}
      <div className="relative w-20 h-20">
        {/* Outer ring — pulses on activity */}
        <div className={`absolute inset-0 rounded-full border transition-all duration-500 ${
          state === 'idle'       ? 'border-zinc-700/40 scale-100'           :
          state === 'thinking'   ? 'border-violet-500/40 scale-110 animate-pulse' :
          state === 'responding' ? 'border-violet-400/60 scale-105'         :
                                   'border-amber-400/50 scale-110 animate-pulse'
        }`} />
        {/* Second ring */}
        <div className={`absolute inset-2 rounded-full border transition-all duration-700 ${
          state === 'idle'       ? 'border-zinc-800/60'              :
          state === 'thinking'   ? 'border-violet-600/50 animate-spin-slow' :
          state === 'responding' ? 'border-violet-500/40'            :
                                   'border-amber-500/40 animate-pulse'
        }`} />
        {/* Core */}
        <div className={`absolute inset-4 rounded-full flex items-center justify-center transition-all duration-300 ${
          state === 'idle'       ? 'bg-zinc-900'              :
          state === 'thinking'   ? 'bg-violet-950/80'         :
          state === 'responding' ? 'bg-violet-900/60'         :
                                   'bg-amber-950/60'
        }`}>
          <Zap className={`w-5 h-5 transition-all duration-300 ${
            state === 'idle'       ? 'text-zinc-600'    :
            state === 'thinking'   ? 'text-violet-400 animate-pulse' :
            state === 'responding' ? 'text-violet-300'  :
                                     'text-amber-400 animate-pulse'
          }`} />
        </div>
        {/* Dot indicators — orbit */}
        {state !== 'idle' && (
          <>
            <div className={`absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1 w-1.5 h-1.5 rounded-full ${state === 'executing' ? 'bg-amber-400' : 'bg-violet-400'} animate-pulse`} />
            <div className={`absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-1 w-1 h-1 rounded-full ${state === 'executing' ? 'bg-amber-500' : 'bg-violet-500'} animate-pulse`} style={{ animationDelay: '0.3s' }} />
          </>
        )}
      </div>
      {/* Name + state */}
      <div className="text-center">
        <p className="font-mono text-xs tracking-[0.2em] text-zinc-300 uppercase">Javari</p>
        <p className={`font-mono text-[10px] tracking-widest mt-0.5 transition-colors duration-300 ${
          state === 'idle'       ? 'text-zinc-600' :
          state === 'thinking'   ? 'text-violet-500 animate-pulse' :
          state === 'responding' ? 'text-violet-400' :
                                   'text-amber-500 animate-pulse'
        }`}>
          {state.toUpperCase()}
        </p>
      </div>
    </div>
  )
}

// ── Panel wrapper ──────────────────────────────────────────────────────────────
function Panel({
  label, glyph, children, accent = false, className = '', live = false
}: {
  label: string; glyph?: string; children: React.ReactNode
  accent?: boolean; className?: string; live?: boolean
}) {
  return (
    <div className={`flex flex-col rounded-xl border overflow-hidden transition-all duration-300
      ${accent
        ? 'border-violet-800/40 bg-gradient-to-b from-violet-950/30 to-zinc-950/80'
        : 'border-zinc-800/50 bg-zinc-950/60'
      } backdrop-blur-sm ${className}`}>
      {/* Panel header bar */}
      <div className={`flex items-center gap-2 px-4 py-2.5 border-b flex-shrink-0 ${accent ? 'border-violet-800/30' : 'border-zinc-800/40'}`}>
        {glyph && <span className={`font-mono text-[10px] ${accent ? 'text-violet-500' : 'text-zinc-600'}`}>{glyph}</span>}
        <span className="font-mono text-[10px] tracking-[0.2em] text-zinc-500 uppercase flex-1">{label}</span>
        {live && (
          <div className="flex items-center gap-1">
            <span className="w-1 h-1 rounded-full bg-emerald-400 animate-pulse" />
            <span className="font-mono text-[9px] text-zinc-700 tracking-widest">LIVE</span>
          </div>
        )}
      </div>
      {children}
    </div>
  )
}

// ── Message bubble ─────────────────────────────────────────────────────────────
function Bubble({ msg }: { msg: Message }) {
  if (msg.role === 'system') {
    return (
      <div className="flex justify-center py-1">
        <span className="font-mono text-[10px] text-zinc-700 tracking-wider">{msg.content}</span>
      </div>
    )
  }

  const isUser  = msg.role === 'user'
  const isAgent = msg.role === 'agent' && msg.agent
  const agentCfg = isAgent ? AGENTS[msg.agent!] : null

  return (
    <div className={`flex gap-2 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
      {/* Glyph */}
      <div className="flex-shrink-0 pt-0.5">
        {isUser
          ? <div className="w-6 h-6 rounded-md bg-zinc-800 flex items-center justify-center"><span className="font-mono text-[9px] text-zinc-400">YOU</span></div>
          : isAgent
            ? <div className={`w-6 h-6 rounded-md flex items-center justify-center bg-zinc-900 font-mono text-sm ${agentCfg!.color}`}>{agentCfg!.glyph}</div>
            : <div className="w-6 h-6 rounded-md bg-violet-950 flex items-center justify-center"><Zap className="w-3 h-3 text-violet-400" /></div>
        }
      </div>

      <div className={`flex flex-col gap-1 max-w-[78%] ${isUser ? 'items-end' : 'items-start'}`}>
        {/* Agent label */}
        {isAgent && (
          <span className={`font-mono text-[10px] tracking-wider ${agentCfg!.dim}`}>{agentCfg!.label.toUpperCase()}</span>
        )}

        <div className={`px-3 py-2.5 rounded-xl text-sm leading-relaxed whitespace-pre-wrap break-words ${
          isUser
            ? 'bg-violet-600/90 text-white rounded-tr-sm'
            : msg.error
              ? 'bg-red-950/50 text-red-300 border border-red-800/30 rounded-tl-sm'
              : isAgent
                ? 'bg-zinc-900/80 text-zinc-200 rounded-tl-sm border border-zinc-800/40'
                : 'bg-zinc-900/60 text-zinc-100 rounded-tl-sm border border-zinc-800/30'
        }`}>
          {msg.content}
        </div>

        {/* Meta */}
        {msg.model && !msg.error && (
          <div className="flex items-center gap-2 px-1">
            <Cpu className="w-2.5 h-2.5 text-zinc-700" />
            <span className="font-mono text-[9px] text-zinc-700">{msg.model.split('-').slice(-2).join('-')}</span>
            {msg.tier && (
              <span className={`font-mono text-[9px] px-1 rounded ${
                msg.tier === 'free' ? 'text-emerald-600 bg-emerald-950/50' :
                msg.tier === 'low'  ? 'text-blue-600 bg-blue-950/50' :
                                      'text-amber-600 bg-amber-950/50'
              }`}>{msg.tier}</span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Thinking dots ──────────────────────────────────────────────────────────────
function ThinkingDots({ mode }: { mode: ChatMode }) {
  return (
    <div className="flex gap-2 items-start">
      <div className="w-6 h-6 rounded-md bg-violet-950 flex items-center justify-center flex-shrink-0 pt-0.5">
        <Zap className="w-3 h-3 text-violet-400 animate-pulse" />
      </div>
      <div className="bg-zinc-900/60 border border-zinc-800/30 rounded-xl rounded-tl-sm px-3 py-2.5 flex items-center gap-2">
        <div className="flex gap-1">
          {[0,1,2].map(i => (
            <div key={i} className="w-1.5 h-1.5 bg-violet-500 rounded-full animate-bounce"
              style={{ animationDelay: `${i * 0.15}s` }} />
          ))}
        </div>
        <span className="font-mono text-[10px] text-zinc-600">
          {mode === 'council' ? 'Council deliberating…' : 'Javari processing…'}
        </span>
      </div>
    </div>
  )
}

// ── Main ───────────────────────────────────────────────────────────────────────
export const dynamic = 'force-dynamic'

export default function JavariOSPage() {
  const [mode,      setMode]      = useState<ChatMode>('single')
  const [messages,  setMessages]  = useState<Message[]>([
    { id: '0', role: 'system', content: 'Javari OS online — Your Story. Our Design.', ts: Date.now() }
  ])
  const [input,     setInput]     = useState('')
  const [loading,   setLoading]   = useState(false)
  const [avatarState, setAvatarState] = useState<AvatarState>('idle')
  const [modeOpen,  setModeOpen]  = useState(false)
  const [agentSteps, setAgentSteps] = useState<AgentStep[]>([])
  const [execLog,   setExecLog]   = useState<ExecEntry[]>([])
  const [sysStatus, setSysStatus] = useState<SystemStatus | null>(null)
  const [execPulse, setExecPulse] = useState(false)

  const bottomRef = useRef<HTMLDivElement>(null)
  const textRef   = useRef<HTMLTextAreaElement>(null)

  // Auto-scroll chat
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  // Auto-resize textarea
  useEffect(() => {
    const el = textRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 160) + 'px'
  }, [input])

  // Poll status for execution panel
  const fetchStatus = useCallback(async () => {
    try {
      const res  = await fetch('/api/autonomy/status', { cache: 'no-store' })
      const data = await res.json()
      if (data.ok) {
        const c = data.canonical ?? {}
        setSysStatus({
          total:     c.total     ?? 275,
          completed: c.completed ?? 0,
          verified:  c.verified  ?? 0,
          pending:   c.pending   ?? 0,
          phase:     data.system?.active_phase ?? 2,
          mode:      data.system?.mode ?? 'BUILD',
          pct:       c.pct_verified ?? 0,
          budget_left: data.system?.budget_left,
        })
        // Load recent executions
        const recent = (data.recent_executions ?? []).slice(0, 6) as Array<Record<string, unknown>>
        setExecLog(recent.map((e, i) => ({
          id:       String(e.id ?? i),
          title:    String(e.id ?? 'Task').split(':').pop()?.replace(/-/g, ' ') ?? 'Task',
          phase:    2,
          module:   String(e.type ?? '—'),
          model:    String(e.model ?? ''),
          cost:     Number(e.cost ?? 0),
          status:   String(e.status ?? 'unknown'),
          verified: Boolean(e.verification),
          ts:       Date.now() - i * 30000,
        })))
      }
    } catch { /* non-fatal */ }
  }, [])

  useEffect(() => {
    fetchStatus()
    const t = setInterval(fetchStatus, 15_000)
    return () => clearInterval(t)
  }, [fetchStatus])

  // ── Send message ─────────────────────────────────────────────────────────────
  const send = useCallback(async (text?: string) => {
    const content = (text ?? input).trim()
    if (!content || loading) return

    setMessages(m => [...m, { id: Date.now().toString(), role: 'user', content, ts: Date.now() }])
    setInput('')
    setLoading(true)
    setAvatarState('thinking')
    setAgentSteps([])

    // Log to memory (fire-and-forget)
    const cron = 'javari-cron-2025-phase2-autonomous'
    fetch('/api/javari/learning/update', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${cron}` },
      body:    JSON.stringify({
        records: [{
          task_id:        `chat-${Date.now()}`,
          task_title:     content.slice(0, 100),
          task_source:    'javari_ui',
          task_type:      'chat',
          status:         'completed',
          canonical_valid: false,
          phase_id:       '',
          cycle_id:       `ui-${Date.now()}`,
        }],
      }),
    }).catch(() => {/* non-fatal */})

    try {
      if (mode === 'council') {
        // Multi-model council
        const res  = await fetch('/api/javari/team', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ message: content }),
        })
        const data = await res.json()

        if (data.steps?.length) {
          setAgentSteps(data.steps)
          setAvatarState('responding')

          // Display each agent step as a labeled message
          const agentRoleMap: Record<string, AgentRole> = {
            planner:   'architect',
            builder:   'builder',
            validator: 'analyst',
          }
          const agentMsgs: Message[] = data.steps.map((step: AgentStep) => ({
            id:      Date.now().toString() + Math.random(),
            role:    'agent' as const,
            agent:   agentRoleMap[step.role] ?? 'analyst',
            content: step.content,
            model:   step.model,
            tier:    step.tier,
            cost:    step.cost,
            ts:      Date.now(),
          }))
          setMessages(m => [...m, ...agentMsgs])

          // Final synthesis if available
          if (data.synthesis) {
            setMessages(m => [...m, {
              id: Date.now().toString(), role: 'assistant',
              content: data.synthesis, model: data.model, tier: data.tier, ts: Date.now(),
            }])
          }
        } else if (data.content) {
          setMessages(m => [...m, {
            id: Date.now().toString(), role: 'assistant',
            content: data.content, model: data.model, tier: data.tier, ts: Date.now(),
          }])
        } else {
          throw new Error(data.error ?? 'No council response')
        }

      } else {
        // Single AI
        const res  = await fetch('/api/javari/chat', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ message: content }),
        })
        const data = await res.json()

        if (data.content) {
          setAvatarState('responding')
          setMessages(m => [...m, {
            id:      Date.now().toString(),
            role:    'assistant',
            content: data.content,
            model:   data.model,
            tier:    data.tier,
            ts:      Date.now(),
          }])
        } else {
          throw new Error(data.error ?? 'No response')
        }
      }
    } catch (err: unknown) {
      setMessages(m => [...m, {
        id: Date.now().toString(), role: 'assistant', error: true,
        content: `${err instanceof Error ? err.message : String(err)}`,
        ts: Date.now(),
      }])
    } finally {
      setLoading(false)
      setTimeout(() => setAvatarState('idle'), 2500)
    }
  }, [input, loading, mode])

  // ── Trigger execution loop (from chat intent) ─────────────────────────────
  const triggerExecution = useCallback(async () => {
    setAvatarState('executing')
    setExecPulse(true)
    try {
      const res  = await fetch('/api/autonomy/loop')
      const data = await res.json()
      if (data.executed?.length) {
        const newEntries: ExecEntry[] = data.executed.map((e: Record<string,unknown>, i: number) => ({
          id:       String(e.id ?? i),
          title:    String(e.title ?? 'Task'),
          phase:    Number(e.phase ?? 2),
          module:   String(e.module ?? ''),
          model:    String(e.model ?? ''),
          cost:     Number(e.cost ?? 0),
          status:   String(e.status ?? 'completed'),
          verified: Boolean(e.verified),
          ts:       Date.now(),
        }))
        setExecLog(prev => [...newEntries, ...prev].slice(0, 20))
        // Post to chat
        setMessages(m => [...m, {
          id:      Date.now().toString(),
          role:    'system',
          content: `⚡ Executed ${data.completed_verified ?? data.tasks_run ?? 0} tasks — ${data.daily_spend} spent`,
          ts:      Date.now(),
        }])
        await fetchStatus()
      }
    } catch { /* non-fatal */ }
    finally {
      setTimeout(() => { setAvatarState('idle'); setExecPulse(false) }, 3000)
    }
  }, [fetchStatus])

  // Detect execution intent in user message
  const hasMessages = messages.filter(m => m.role !== 'system').length > 0

  const SUGGESTIONS = [
    'Help me write a business proposal',
    'Create content for my brand',
    'Analyze my market positioning',
    'Build a social media strategy',
    'Explain this concept clearly',
    'Draft a professional email',
  ]

  return (
    <div
      className="h-screen bg-zinc-950 text-zinc-100 overflow-hidden flex flex-col"
      onClick={() => setModeOpen(false)}
    >
      {/* Grid lines overlay */}
      <div className="pointer-events-none fixed inset-0 z-0 opacity-[0.015]"
        style={{ backgroundImage: 'linear-gradient(to right, #fff 1px, transparent 1px), linear-gradient(to bottom, #fff 1px, transparent 1px)', backgroundSize: '48px 48px' }} />

      {/* Ambient glow */}
      <div className="pointer-events-none fixed inset-0 z-0">
        <div className="absolute top-0 left-1/4 w-96 h-48 bg-violet-900/8 rounded-full blur-3xl" />
        <div className="absolute bottom-0 right-1/4 w-64 h-32 bg-indigo-900/6 rounded-full blur-3xl" />
      </div>

      {/* ── Top bar ─────────────────────────────────────────────────────── */}
      <div className="flex-shrink-0 flex items-center justify-between px-5 py-2.5 border-b border-zinc-800/50 bg-zinc-950/80 backdrop-blur-sm z-10 relative">
        <div className="flex items-center gap-3">
          <div className="w-6 h-6 rounded-md bg-gradient-to-br from-violet-600 to-indigo-700 flex items-center justify-center">
            <Zap className="w-3.5 h-3.5 text-white" />
          </div>
          <span className="font-mono text-xs tracking-[0.25em] text-zinc-400 uppercase">Javari OS</span>
          <span className="text-zinc-800 font-mono text-xs">·</span>
          <span className="font-mono text-[10px] text-zinc-600 tracking-wider">Your Story. Our Design.</span>
        </div>
        <div className="flex items-center gap-3">
          {sysStatus && (
            <div className="hidden sm:flex items-center gap-3 font-mono text-[10px] text-zinc-600">
              <span className={sysStatus.mode === 'BUILD' ? 'text-blue-500' : 'text-amber-500'}>{sysStatus.mode}</span>
              <span>P{sysStatus.phase}</span>
              <span className="text-zinc-700">|</span>
              <span className="text-emerald-600">{sysStatus.pct}% verified</span>
            </div>
          )}
          <a href="/command-center"
            className="px-2.5 py-1 font-mono text-[9px] tracking-widest uppercase text-zinc-700 hover:text-zinc-500 border border-zinc-800/60 hover:border-zinc-700 rounded-lg transition-all">
            ⚙ Admin
          </a>
        </div>
      </div>

      {/* ── Quadrant grid ────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-hidden z-10 relative p-3 grid gap-3
        grid-cols-1 grid-rows-[auto_1fr_auto_auto]
        sm:grid-cols-[280px_1fr] sm:grid-rows-[1fr_auto]
        lg:grid-cols-[220px_1fr_240px] lg:grid-rows-[1fr_200px]
        xl:grid-cols-[240px_1fr_260px] xl:grid-rows-[1fr_210px]
      ">

        {/* ── Q1: Avatar + Status (top-left on lg) ────────────────────── */}
        <Panel label="System" glyph="◈" className="
          sm:row-span-1 sm:col-start-1
          lg:row-span-1 lg:col-start-1 lg:row-start-1
          order-4 sm:order-1">
          <div className="flex-1 flex flex-col items-center justify-between p-5 gap-4 overflow-hidden">
            <JavariAvatar state={avatarState} />

            {/* Status tiles */}
            {sysStatus && (
              <div className="w-full space-y-2">
                {[
                  { label: 'Tasks',    value: `${sysStatus.completed}/${sysStatus.total}`, color: 'text-zinc-300' },
                  { label: 'Verified', value: `${sysStatus.pct}%`,                         color: 'text-emerald-400' },
                  { label: 'Pending',  value: String(sysStatus.pending),                   color: 'text-amber-500' },
                  { label: 'Budget',   value: sysStatus.budget_left != null ? `$${sysStatus.budget_left.toFixed(3)}` : '—', color: 'text-zinc-400' },
                ].map(item => (
                  <div key={item.label} className="flex items-center justify-between px-2">
                    <span className="font-mono text-[10px] text-zinc-700 uppercase tracking-widest">{item.label}</span>
                    <span className={`font-mono text-xs font-bold tabular-nums ${item.color}`}>{item.value}</span>
                  </div>
                ))}
                {/* Mini progress bar */}
                <div className="mx-2 h-1 bg-zinc-800 rounded-full overflow-hidden">
                  <div className="h-full bg-gradient-to-r from-indigo-600 to-emerald-500 rounded-full transition-all duration-700"
                    style={{ width: `${sysStatus.pct}%` }} />
                </div>
              </div>
            )}

            {/* Execute button */}
            <button onClick={triggerExecution}
              disabled={avatarState === 'executing'}
              className={`w-full py-2 rounded-lg font-mono text-[10px] tracking-widest uppercase transition-all border ${
                avatarState === 'executing'
                  ? 'border-amber-700/40 bg-amber-950/30 text-amber-600 cursor-wait'
                  : 'border-zinc-800 bg-zinc-900/60 text-zinc-500 hover:border-amber-700/50 hover:text-amber-500 hover:bg-amber-950/20'
              }`}>
              {avatarState === 'executing' ? '⚡ Executing…' : '▶ Run Loop'}
            </button>
          </div>
        </Panel>

        {/* ── Q2: Main Chat (top-right, spans rows on lg) ──────────────── */}
        <Panel label="Javari AI" glyph="◉" accent className="
          sm:col-start-2 sm:row-start-1
          lg:col-start-2 lg:row-start-1 lg:row-span-2
          order-1 min-h-[400px] sm:min-h-0 flex flex-col">

          {/* Mode selector — inline in panel header area */}
          <div className="flex items-center justify-between px-4 py-2 border-b border-violet-800/20 flex-shrink-0">
            <span className="font-mono text-[10px] text-zinc-700">
              {mode === 'single' ? 'Single AI — cost-optimised' : 'AI Council — multi-model ensemble'}
            </span>
            <div className="relative" onClick={e => e.stopPropagation()}>
              <button onClick={() => setModeOpen(v => !v)}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-zinc-900 border border-zinc-800 hover:border-violet-700/50 text-[10px] font-mono text-zinc-400 transition-all">
                {mode === 'single' ? <Cpu className="w-3 h-3" /> : <Users className="w-3 h-3" />}
                {mode === 'single' ? 'Single' : 'Council'}
                <ChevronDown className={`w-3 h-3 transition-transform ${modeOpen ? 'rotate-180' : ''}`} />
              </button>
              {modeOpen && (
                <div className="absolute right-0 top-full mt-1 w-52 bg-zinc-900 border border-zinc-800 rounded-xl shadow-2xl z-50">
                  {[
                    { id: 'single' as ChatMode,  Icon: Cpu,   label: 'Javari Single',    desc: 'Fastest. Best model for task.' },
                    { id: 'council' as ChatMode, Icon: Users, label: 'AI Council',        desc: 'Architect + Builder + Analyst.' },
                  ].map(({ id, Icon, label, desc }) => (
                    <button key={id} onClick={() => { setMode(id); setModeOpen(false) }}
                      className={`w-full flex items-start gap-3 px-4 py-3 text-left hover:bg-zinc-800 transition-colors first:rounded-t-xl last:rounded-b-xl ${mode === id ? 'bg-violet-900/30' : ''}`}>
                      <Icon className={`w-3.5 h-3.5 mt-0.5 ${mode === id ? 'text-violet-400' : 'text-zinc-600'}`} />
                      <div>
                        <p className={`font-mono text-xs ${mode === id ? 'text-violet-300' : 'text-zinc-300'}`}>{label}</p>
                        <p className="font-mono text-[10px] text-zinc-600 mt-0.5">{desc}</p>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
            {hasMessages && (
              <button onClick={() => {
                setMessages([{ id: Date.now().toString(), role: 'system', content: 'New session.', ts: Date.now() }])
                setAgentSteps([])
              }} className="p-1 text-zinc-700 hover:text-zinc-500 transition-colors ml-1">
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4 min-h-0">
            {!hasMessages && (
              <div className="h-full flex flex-col items-center justify-center gap-5 text-center select-none pb-4">
                <div className="w-12 h-12 rounded-xl bg-violet-950/60 border border-violet-800/30 flex items-center justify-center">
                  <Zap className="w-6 h-6 text-violet-400" />
                </div>
                <div>
                  <p className="text-sm font-medium text-zinc-300">Ask Javari anything</p>
                  <p className="text-xs text-zinc-600 mt-1">Single AI or AI Council mode</p>
                </div>
                <div className="flex flex-wrap gap-1.5 justify-center max-w-sm">
                  {SUGGESTIONS.map(s => (
                    <button key={s} onClick={() => send(s)}
                      className="px-2.5 py-1.5 text-[11px] text-zinc-500 bg-zinc-900/60 border border-zinc-800/60 rounded-lg hover:border-violet-700/40 hover:text-violet-300 hover:bg-violet-900/10 transition-all font-mono">
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {messages.map(msg => <Bubble key={msg.id} msg={msg} />)}
            {loading && <ThinkingDots mode={mode} />}
            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <div className="flex-shrink-0 px-4 pb-4 pt-2 border-t border-violet-800/20">
            <div className="flex items-end gap-2 bg-zinc-900/60 border border-zinc-800 hover:border-violet-700/40 focus-within:border-violet-600/50 rounded-xl px-3 py-2.5 transition-all">
              <textarea
                ref={textRef}
                className="flex-1 bg-transparent resize-none text-sm text-zinc-200 placeholder-zinc-700 outline-none leading-relaxed min-h-[20px] max-h-[160px] font-['system-ui']"
                placeholder={mode === 'council' ? 'Consult the AI Council…' : 'Message Javari…'}
                rows={1}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
              />
              <button onClick={() => send()} disabled={!input.trim() || loading}
                className="flex-shrink-0 w-7 h-7 rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-25 disabled:cursor-not-allowed flex items-center justify-center transition-colors">
                <Send className="w-3.5 h-3.5 text-white" />
              </button>
            </div>
          </div>
        </Panel>

        {/* ── Q3: Agent Panel (bottom-left on lg) ──────────────────────── */}
        <Panel label="AI Agents" glyph="◎" className="
          sm:col-start-1 sm:row-start-2
          lg:col-start-1 lg:row-start-2
          order-3">
          <div className="flex-1 p-4 space-y-3 overflow-hidden">
            {Object.entries(AGENTS).map(([key, cfg]) => {
              const role     = key as AgentRole
              const step     = agentSteps.find(s => {
                const map: Record<string,string> = { planner:'architect', builder:'builder', validator:'analyst' }
                return map[s.role] === role
              })
              const isActive = loading && mode === 'council'
              return (
                <div key={role} className={`flex items-start gap-3 p-3 rounded-lg border transition-all duration-300 ${
                  step
                    ? 'border-zinc-700/60 bg-zinc-900/60'
                    : isActive
                      ? 'border-zinc-800/40 bg-zinc-900/20 animate-pulse'
                      : 'border-zinc-800/20 bg-transparent'
                }`}>
                  <span className={`font-mono text-lg leading-none mt-0.5 ${cfg.color}`}>{cfg.glyph}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`font-mono text-[10px] uppercase tracking-widest ${cfg.color}`}>{cfg.label}</span>
                      {step && (
                        <span className="font-mono text-[9px] text-zinc-700">{step.model?.split('-').slice(-2).join('-')}</span>
                      )}
                      {isActive && !step && (
                        <span className="font-mono text-[9px] text-zinc-700 animate-pulse">waiting…</span>
                      )}
                    </div>
                    {step ? (
                      <p className="text-[11px] text-zinc-400 leading-relaxed line-clamp-3">{step.content}</p>
                    ) : (
                      <p className="font-mono text-[10px] text-zinc-700">
                        {role === 'architect' ? 'Plans & breaks down tasks' :
                         role === 'builder'   ? 'Implements solutions'      :
                                                'Validates & analyses'}
                      </p>
                    )}
                  </div>
                  {step && (
                    <span className="font-mono text-[9px] text-zinc-700 tabular-nums flex-shrink-0">${step.cost.toFixed(5)}</span>
                  )}
                </div>
              )
            })}

            {mode === 'single' && (
              <div className="pt-1 font-mono text-[10px] text-zinc-700 text-center">
                Switch to Council mode to activate all agents
              </div>
            )}
          </div>
        </Panel>

        {/* ── Q4: Execution Panel (bottom-right on lg) ─────────────────── */}
        <Panel label="Execution" glyph="◐" live className="
          sm:col-start-2 sm:row-start-2
          lg:col-start-3 lg:row-start-1 lg:row-span-2
          order-2 sm:order-4">
          <div className="flex-1 overflow-y-auto p-3 space-y-1.5 min-h-0">
            {execLog.length === 0 && (
              <div className="h-full flex flex-col items-center justify-center text-center py-6">
                <Activity className="w-6 h-6 text-zinc-800 mb-2" />
                <p className="font-mono text-[10px] text-zinc-700">No executions yet</p>
                <p className="font-mono text-[9px] text-zinc-800 mt-1">Click Run Loop to start</p>
              </div>
            )}
            {execLog.map(entry => (
              <div key={entry.id + entry.ts}
                className={`p-2.5 rounded-lg border transition-all ${
                  execPulse && entry.ts > Date.now() - 5000
                    ? 'border-amber-700/40 bg-amber-950/20'
                    : 'border-zinc-800/30 bg-zinc-900/30'
                }`}>
                <div className="flex items-start gap-2">
                  <span className={`font-mono text-[10px] flex-shrink-0 mt-0.5 ${
                    entry.status === 'completed' && entry.verified ? 'text-emerald-500' :
                    entry.status === 'completed'                   ? 'text-blue-500'    :
                    entry.status === 'failed'                      ? 'text-red-500'     :
                                                                     'text-amber-500'
                  }`}>
                    {entry.verified ? '✓' : entry.status === 'failed' ? '✗' : '○'}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] text-zinc-300 leading-tight truncate capitalize">{entry.title}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="font-mono text-[9px] text-zinc-700">{entry.module || entry.type}</span>
                      {entry.model && <span className="font-mono text-[9px] text-zinc-700">{entry.model?.split('-').slice(-1)}</span>}
                      {entry.cost != null && entry.cost > 0 && (
                        <span className="font-mono text-[9px] text-zinc-700 ml-auto tabular-nums">${Number(entry.cost).toFixed(5)}</span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Panel>

      </div>

      {/* Inline CSS for slow spin */}
      <style>{`
        @keyframes spin-slow { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .animate-spin-slow { animation: spin-slow 3s linear infinite; }
      `}</style>
    </div>
  )
}
