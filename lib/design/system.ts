// lib/design/system.ts
// Javari Design System — canonical tokens
// Single source of truth for all UI primitives.
// Import these — never hardcode hex values, arbitrary px, or ad-hoc class strings.
// Tuesday, March 17, 2026

// ── Color tokens ──────────────────────────────────────────────────────────────
export const colors = {
  // Base surfaces — dark theme only, no white backgrounds
  surface: {
    base:     'bg-zinc-950',          // page root — never white
    panel:    'bg-zinc-900/40',       // glass panels
    elevated: 'bg-zinc-900/70',       // modals, popovers
    overlay:  'bg-black/60',          // backdrop
    input:    'bg-zinc-900',          // form inputs
  },
  // Borders
  border: {
    default: 'border-zinc-800/60',
    subtle:  'border-zinc-800/30',
    focus:   'border-indigo-500',
    error:   'border-red-700/60',
  },
  // Text
  text: {
    primary:   'text-zinc-100',
    secondary: 'text-zinc-400',
    muted:     'text-zinc-600',
    inverse:   'text-zinc-950',
    link:      'text-indigo-400',
  },
  // Status — matches lifecycle in autonomy loop
  status: {
    pending:     'text-amber-400',
    in_progress: 'text-blue-400',
    retry:       'text-orange-400',
    verifying:   'text-violet-400',
    blocked:     'text-red-400',
    completed:   'text-emerald-400',
    failed:      'text-red-500',
    running:     'text-blue-400',     // legacy alias
  },
  statusBg: {
    pending:     'bg-amber-400/10  ring-amber-400/20',
    in_progress: 'bg-blue-400/10   ring-blue-400/20',
    retry:       'bg-orange-400/10 ring-orange-400/20',
    verifying:   'bg-violet-400/10 ring-violet-400/20',
    blocked:     'bg-red-400/10    ring-red-400/20',
    completed:   'bg-emerald-400/10 ring-emerald-400/20',
    failed:      'bg-red-500/10    ring-red-500/20',
    running:     'bg-blue-400/10   ring-blue-400/20',
  },
  // Gradients
  gradient: {
    brand:   'from-indigo-600 to-violet-600',    // primary CTA
    accent:  'from-indigo-500 to-blue-500',      // secondary
    success: 'from-emerald-600 to-teal-500',
    danger:  'from-red-600 to-rose-500',
    budget:  {
      low:    'from-indigo-600 to-emerald-400',
      medium: 'from-amber-600  to-amber-400',
      high:   'from-red-600    to-red-400',
    },
  },
} as const

// ── Typography ────────────────────────────────────────────────────────────────
export const typography = {
  // Display — page titles
  display: 'text-2xl font-bold text-zinc-100',
  // Heading — section headers
  heading: 'text-base font-semibold text-zinc-200',
  // Label — table headers, stat labels
  label:   'font-mono text-[10px] tracking-[0.2em] text-zinc-500 uppercase',
  // Body
  body:    'text-sm text-zinc-300',
  bodySmall: 'text-xs text-zinc-400',
  // Data / numbers — instrument panel style
  data:    'font-mono tabular-nums',
  dataLg:  'font-mono text-4xl font-bold tabular-nums',
  // Code
  code:    'font-mono text-xs text-zinc-300',
} as const

// ── Spacing ───────────────────────────────────────────────────────────────────
export const spacing = {
  page:    'max-w-7xl mx-auto px-6 py-8',
  section: 'space-y-6',
  card:    'p-5',
  compact: 'p-3',
  row:     'px-5 py-3',
  gap:     'gap-4',
  gapSm:   'gap-3',
} as const

// ── Component patterns ────────────────────────────────────────────────────────
export const components = {
  // Panel — glass card
  panel: [
    'rounded-xl',
    'border border-zinc-800/60',
    'bg-zinc-900/40',
    'backdrop-blur-sm',
  ].join(' '),

  // Elevated panel
  panelElevated: [
    'rounded-xl',
    'border border-zinc-800/80',
    'bg-gradient-to-b from-zinc-900/90 to-zinc-950/90',
    'backdrop-blur-sm',
    'shadow-lg shadow-black/40',
  ].join(' '),

  // Button — primary
  btnPrimary: [
    'px-4 py-2 rounded-lg',
    'bg-gradient-to-r from-indigo-600 to-violet-600',
    'hover:from-indigo-500 hover:to-violet-500',
    'text-white font-medium text-sm',
    'transition-all duration-200',
    'shadow-lg shadow-indigo-900/30',
  ].join(' '),

  // Button — secondary
  btnSecondary: [
    'px-3 py-1.5 rounded-lg',
    'border border-zinc-800',
    'bg-zinc-900/60',
    'hover:border-zinc-600 hover:bg-zinc-800',
    'text-zinc-400 hover:text-zinc-200',
    'font-mono text-[10px] tracking-widest uppercase',
    'transition-all duration-200',
  ].join(' '),

  // Table
  tableHeader: 'px-5 py-2.5 text-left font-mono text-[9px] tracking-[0.2em] text-zinc-600 uppercase',
  tableRow:    'border-b border-zinc-800/20 hover:bg-white/[0.02] transition-colors group',
  tableCell:   'px-5 py-3',

  // Status badge
  badge: 'inline-flex items-center gap-1.5 px-2 py-0.5 rounded ring-1 font-mono text-[10px] tracking-widest',

  // Input
  input: [
    'w-full px-3 py-2 rounded-lg',
    'bg-zinc-900 border border-zinc-800',
    'text-zinc-200 placeholder-zinc-600',
    'focus:outline-none focus:border-indigo-500',
    'font-mono text-sm',
    'transition-colors',
  ].join(' '),

  // Divider
  divider: 'border-b border-zinc-800/60',
} as const

// ── Animation classes ─────────────────────────────────────────────────────────
export const animation = {
  ping:   'animate-ping',
  pulse:  'animate-pulse',
  spin:   'animate-spin',
  fadeIn: 'transition-opacity duration-300',
  slide:  'transition-all duration-300',
} as const

// ── Design system enforcement helpers ────────────────────────────────────────
/**
 * Returns the full Tailwind class string for a given status.
 * Use this instead of hardcoding color classes.
 */
export function statusClasses(status: string): { text: string; bg: string } {
  const s = status === 'running' ? 'in_progress' : status
  return {
    text: colors.status[s as keyof typeof colors.status] ?? colors.text.muted,
    bg:   colors.statusBg[s as keyof typeof colors.statusBg] ?? '',
  }
}

/**
 * Validates that a component does not use forbidden patterns.
 * Call during development — not in production hot path.
 */
export function auditComponent(source: string): string[] {
  const violations: string[] = []
  if (/bg-white(?!\/)/.test(source))     violations.push('bg-white: use bg-zinc-950 or bg-zinc-900/40')
  if (/text-black/.test(source))          violations.push('text-black: use text-zinc-100')
  if (/style=\{/.test(source))            violations.push('Inline style: use design system tokens')
  if (/className="[^"]*\bwhite\b/.test(source)) violations.push('white class: use dark theme tokens')
  return violations
}

// ── Version ───────────────────────────────────────────────────────────────────
export const DESIGN_SYSTEM_VERSION = '1.0.0'
export const DESIGN_SYSTEM_DATE    = '2026-03-17'
