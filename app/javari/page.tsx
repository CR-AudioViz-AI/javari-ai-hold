// app/javari/page.tsx
// Javari AI — Customer Chat Interface
// The real product. No execution logs. No admin panels. Just Javari.
// Mission: "Your Story. Our Design."
// Tuesday, March 17, 2026
'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { Send, Cpu, Users, Zap, RotateCcw, ChevronDown } from 'lucide-react'

// ── Types ─────────────────────────────────────────────────────────────────────
type Mode = 'single' | 'team'
type Role = 'user' | 'assistant' | 'system'

interface Message {
  id:       string
  role:     Role
  content:  string
  model?:   string
  tier?:    string
  ts:       number
  error?:   boolean
}

// ── Mode config ───────────────────────────────────────────────────────────────
const MODES: { id: Mode; label: string; icon: React.ReactNode; desc: string }[] = [
  { id: 'single', label: 'Javari',    icon: <Cpu   className="w-3.5 h-3.5" />, desc: 'Cost-optimised single AI — fastest response' },
  { id: 'team',   label: 'AI Council', icon: <Users className="w-3.5 h-3.5" />, desc: 'Multi-model ensemble — best answer wins' },
]

// ── Suggested prompts ─────────────────────────────────────────────────────────
const SUGGESTIONS = [
  'Help me write a business plan',
  'Create a professional email',
  'Build a social media strategy',
  'Explain this concept simply',
  'Review my content idea',
  'Generate copy for my brand',
]

// ── Tier badge color ──────────────────────────────────────────────────────────
function tierColor(tier?: string) {
  if (tier === 'free')     return 'text-emerald-400 bg-emerald-400/10'
  if (tier === 'low')      return 'text-blue-400    bg-blue-400/10'
  if (tier === 'moderate') return 'text-amber-400   bg-amber-400/10'
  return 'text-zinc-500 bg-zinc-800'
}

// ── Message bubble ────────────────────────────────────────────────────────────
function MessageBubble({ msg }: { msg: Message }) {
  if (msg.role === 'system') {
    return (
      <div className="flex justify-center">
        <span className="text-[11px] text-zinc-600 bg-zinc-900/60 px-3 py-1 rounded-full">{msg.content}</span>
      </div>
    )
  }

  const isUser = msg.role === 'user'
  return (
    <div className={`flex gap-3 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
      {/* Avatar */}
      {!isUser && (
        <div className="flex-shrink-0 w-7 h-7 rounded-full bg-gradient-to-br from-violet-600 to-indigo-600 flex items-center justify-center mt-0.5">
          <Zap className="w-3.5 h-3.5 text-white" />
        </div>
      )}
      {isUser && (
        <div className="flex-shrink-0 w-7 h-7 rounded-full bg-zinc-700 flex items-center justify-center mt-0.5">
          <span className="text-[10px] font-bold text-zinc-300">YOU</span>
        </div>
      )}

      <div className={`group max-w-[75%] flex flex-col gap-1 ${isUser ? 'items-end' : 'items-start'}`}>
        <div className={`rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap break-words ${
          isUser
            ? 'bg-violet-600 text-white rounded-br-sm'
            : msg.error
              ? 'bg-red-950/60 text-red-300 border border-red-800/40 rounded-bl-sm'
              : 'bg-zinc-800/80 text-zinc-100 rounded-bl-sm'
        }`}>
          {msg.content}
        </div>

        {/* Model badge (assistant only) */}
        {msg.model && !msg.error && (
          <div className="flex items-center gap-1.5 px-1">
            <Cpu className="w-3 h-3 text-zinc-600" />
            <span className="text-[10px] text-zinc-600">
              {msg.model.split('-').slice(-2).join('-')}
            </span>
            {msg.tier && (
              <span className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${tierColor(msg.tier)}`}>
                {msg.tier}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Typing indicator ──────────────────────────────────────────────────────────
function TypingIndicator({ mode }: { mode: Mode }) {
  return (
    <div className="flex gap-3 items-start">
      <div className="flex-shrink-0 w-7 h-7 rounded-full bg-gradient-to-br from-violet-600 to-indigo-600 flex items-center justify-center">
        <Zap className="w-3.5 h-3.5 text-white" />
      </div>
      <div className="bg-zinc-800/80 rounded-2xl rounded-bl-sm px-4 py-3 flex items-center gap-2">
        <div className="flex gap-1">
          {[0,1,2].map(i => (
            <div key={i} className="w-1.5 h-1.5 bg-violet-400 rounded-full animate-bounce"
              style={{ animationDelay: `${i * 0.15}s` }} />
          ))}
        </div>
        <span className="text-xs text-zinc-500">
          {mode === 'team' ? 'AI Council thinking…' : 'Javari thinking…'}
        </span>
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export const dynamic = 'force-dynamic'

export default function JavariPage() {
  const [mode,    setMode]    = useState<Mode>('single')
  const [messages, setMessages] = useState<Message[]>([
    { id: '0', role: 'system', content: 'Javari AI ready — Your Story. Our Design.', ts: Date.now() }
  ])
  const [input,   setInput]   = useState('')
  const [loading, setLoading] = useState(false)
  const [modeOpen, setModeOpen] = useState(false)
  const bottomRef  = useRef<HTMLDivElement>(null)
  const textRef    = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  // Auto-resize textarea
  useEffect(() => {
    const el = textRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 200) + 'px'
  }, [input])

  const send = useCallback(async (text?: string) => {
    const content = (text ?? input).trim()
    if (!content || loading) return

    const userMsg: Message = { id: Date.now().toString(), role: 'user', content, ts: Date.now() }
    setMessages(m => [...m, userMsg])
    setInput('')
    setLoading(true)

    try {
      const endpoint = mode === 'team' ? '/api/javari/team' : '/api/javari/chat'
      const res = await fetch(endpoint, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          message: content,
          mode,
          history: messages.filter(m => m.role !== 'system').slice(-8).map(m => ({
            role: m.role, content: m.content
          })),
        }),
      })
      const data = await res.json()
      if (data.content) {
        setMessages(m => [...m, {
          id:      Date.now().toString(),
          role:    'assistant',
          content: data.content,
          model:   data.model,
          tier:    data.tier,
          ts:      Date.now(),
        }])
      } else {
        throw new Error(data.error ?? 'No response from Javari')
      }
    } catch (err: unknown) {
      setMessages(m => [...m, {
        id:      Date.now().toString(),
        role:    'assistant',
        content: `Unable to reach Javari: ${err instanceof Error ? err.message : String(err)}`,
        ts:      Date.now(),
        error:   true,
      }])
    } finally {
      setLoading(false)
    }
  }, [input, loading, mode, messages])

  const clearChat = useCallback(() => {
    setMessages([{ id: Date.now().toString(), role: 'system', content: 'New conversation started.', ts: Date.now() }])
  }, [])

  const hasMessages = messages.filter(m => m.role !== 'system').length > 0

  return (
    <div className="flex flex-col h-screen bg-zinc-950 text-zinc-100 overflow-hidden">

      {/* ── Header ───────────────────────────────────────────────────── */}
      <div className="flex-shrink-0 flex items-center justify-between px-4 py-3 border-b border-zinc-800/60 bg-zinc-950/95 backdrop-blur-sm">
        <div className="flex items-center gap-3">
          {/* Logo */}
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-violet-600 to-indigo-600 flex items-center justify-center flex-shrink-0">
            <Zap className="w-4 h-4 text-white" />
          </div>
          <div>
            <span className="font-semibold text-zinc-100">Javari AI</span>
            <span className="text-zinc-600 text-xs ml-2">Your Story. Our Design.</span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* Mode selector */}
          <div className="relative">
            <button
              onClick={() => setModeOpen(v => !v)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800 hover:border-zinc-700 text-xs text-zinc-300 transition-all"
            >
              {MODES.find(m => m.id === mode)?.icon}
              <span>{MODES.find(m => m.id === mode)?.label}</span>
              <ChevronDown className={`w-3 h-3 text-zinc-500 transition-transform ${modeOpen ? 'rotate-180' : ''}`} />
            </button>
            {modeOpen && (
              <div className="absolute right-0 top-full mt-1 w-56 bg-zinc-900 border border-zinc-800 rounded-xl shadow-2xl z-50 overflow-hidden">
                {MODES.map(m => (
                  <button key={m.id} onClick={() => { setMode(m.id); setModeOpen(false) }}
                    className={`w-full flex items-start gap-3 px-4 py-3 text-left hover:bg-zinc-800 transition-colors ${mode === m.id ? 'bg-violet-900/30' : ''}`}>
                    <span className={`mt-0.5 ${mode === m.id ? 'text-violet-400' : 'text-zinc-500'}`}>{m.icon}</span>
                    <div>
                      <p className={`text-xs font-medium ${mode === m.id ? 'text-violet-300' : 'text-zinc-300'}`}>{m.label}</p>
                      <p className="text-[11px] text-zinc-600 mt-0.5">{m.desc}</p>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Clear chat */}
          {hasMessages && (
            <button onClick={clearChat} title="New conversation"
              className="p-1.5 rounded-lg text-zinc-600 hover:text-zinc-400 hover:bg-zinc-800 transition-colors">
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* ── Messages ─────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto px-4 py-6 space-y-5" onClick={() => setModeOpen(false)}>

        {/* Welcome screen */}
        {!hasMessages && (
          <div className="flex flex-col items-center justify-center min-h-[60%] text-center gap-6 select-none">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-violet-600 to-indigo-600 flex items-center justify-center shadow-2xl shadow-violet-900/50">
              <Zap className="w-8 h-8 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-zinc-100">Javari AI</h1>
              <p className="text-zinc-500 text-sm mt-1">Your Story. Our Design.</p>
            </div>

            {/* Suggestion chips */}
            <div className="flex flex-wrap gap-2 justify-center max-w-lg">
              {SUGGESTIONS.map(s => (
                <button key={s} onClick={() => send(s)}
                  className="px-3 py-2 text-xs text-zinc-400 bg-zinc-900 border border-zinc-800 rounded-xl hover:border-violet-700 hover:text-violet-300 hover:bg-violet-900/20 transition-all">
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Message list */}
        {messages.map(msg => (
          <MessageBubble key={msg.id} msg={msg} />
        ))}

        {loading && <TypingIndicator mode={mode} />}
        <div ref={bottomRef} />
      </div>

      {/* ── Input bar ────────────────────────────────────────────────── */}
      <div className="flex-shrink-0 px-4 pb-4 pt-2 border-t border-zinc-800/40 bg-zinc-950" onClick={() => setModeOpen(false)}>
        <div className="flex items-end gap-2 bg-zinc-900/80 rounded-2xl border border-zinc-800 hover:border-zinc-700 focus-within:border-violet-700/60 transition-all px-4 py-3">
          <textarea
            ref={textRef}
            className="flex-1 bg-transparent resize-none text-sm text-zinc-100 placeholder-zinc-600 outline-none leading-relaxed min-h-[22px] max-h-[200px]"
            placeholder={mode === 'team' ? 'Ask the AI Council…' : 'Message Javari AI…'}
            rows={1}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                send()
              }
            }}
          />
          <button
            onClick={() => send()}
            disabled={!input.trim() || loading}
            className="flex-shrink-0 w-8 h-8 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center transition-colors"
          >
            <Send className="w-3.5 h-3.5 text-white" />
          </button>
        </div>

        <p className="text-[11px] text-zinc-700 mt-1.5 text-center">
          {mode === 'single'
            ? 'Javari routes to the best available AI for your request'
            : 'Multiple AI models collaborate to find the best answer'}
          {' · '}
          <span className="text-zinc-600">Shift+Enter for new line</span>
        </p>
      </div>

    </div>
  )
}
