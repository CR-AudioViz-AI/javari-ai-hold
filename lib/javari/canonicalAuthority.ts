// lib/javari/canonicalAuthority.ts
// Javari Canonical Authority — validates tasks before execution
// Every task must belong to the active phase and a registered module family.
// Planner tasks without a matching phase_id or module are rejected.
// Tuesday, March 17, 2026

import { createClient } from '@supabase/supabase-js'

// ── Types ─────────────────────────────────────────────────────────────────────
export interface TaskRow {
  id:          string
  title:       string
  description: string | null
  phase_id:    string | null
  source:      string
  metadata:    Record<string, unknown> | null
}

export interface ValidationResult {
  valid:   boolean
  reason?: string
  phase?:  string
  module?: string
}

export interface AuthorityStats {
  total_validated:  number
  total_accepted:   number
  total_rejected:   number
  rejection_reasons: Record<string, number>
  last_reset_at:    string
}

// ── Module registry — canonical Phase 2 module families ──────────────────────
// These are the permitted execution domains for planner tasks.
// Sourced from Master Roadmap v2.0, 55 modules in 6 families.
// Any planner task whose phase_id or title matches a family slug is accepted.
const CANONICAL_MODULE_FAMILIES: Record<string, string[]> = {
  // Phase 2 — Platform infrastructure (current active phase)
  platform_infrastructure: [
    'command_center', 'cost_governor', 'model_router', 'secret_authority',
    'deployment_pipeline', 'multi_ai_chat', 'javari_execution_layer',
    'platform_scaling', 'infrastructure', 'deployment', 'orchestrator',
  ],
  // Phase 2 — Core platform modules
  core_platform: [
    'blueprint_generator', 'autonomous_builder', 'architecture_brain',
    'customer_interview', 'app_generator', 'backend_api', 'frontend_builder',
    'database_schema', 'module_factory',
  ],
  // Phase 2 — AI subsystems
  ai_systems: [
    'multi_ai_team_mode', 'conflict_resolution', 'ai_marketplace',
    'model_selection', 'ai_router', 'ai_council', 'multi_ai',
  ],
  // Phase 2 — Community & social
  community: [
    'community_system', 'community_governance', 'community_events',
    'community_mentorship', 'community_health', 'community_gamification',
    'community_analytics', 'social', 'faith_communities', 'veterans_connect',
    'first_responders', 'animal_rescue',
  ],
  // Phase 2 — Security & compliance
  security_infrastructure: [
    'security_infrastructure', 'threat_intelligence', 'compliance',
    'safety_filter', 'auth', 'encryption', 'audit',
  ],
  // Phase 2 — Business & revenue
  business: [
    'revenue', 'billing', 'credits', 'marketplace', 'affiliates',
    'merchandising', 'enterprise', 'white_label',
  ],
  // Phase 3 — CRAIverse (permitted to queue but not yet active)
  craiverse: [
    'craiverse', 'avatar', 'virtual_real_estate', 'vr_community',
  ],
  // Phase 4 — Ecosystem apps (permitted to queue)
  ecosystem: [
    'javari_games', 'javari_news', 'javari_social', 'javari_forge',
    'javari_sites', 'javari_omni', 'javari_spirits', 'javari_logo',
    'javari_music', 'javari_realty', 'javari_cards',
  ],
}

// Flatten to a lookup set for O(1) matching
const ALL_MODULE_SLUGS = new Set(
  Object.values(CANONICAL_MODULE_FAMILIES).flat()
)

// Phase ID prefixes that map to active phases
const ACTIVE_PHASE_PREFIXES: Record<string, number[]> = {
  'platform': [2],
  'core':     [2],
  'ai_':      [2],
  'multi_ai': [2],
  'community':[2],
  'security': [2],
  'business': [2],
  'craiverse':[3],
  'javari_':  [4],
  'ecosystem':[4],
}

// In-memory stats counter (per process, resets on redeploy)
let stats: AuthorityStats = {
  total_validated:   0,
  total_accepted:    0,
  total_rejected:    0,
  rejection_reasons: {},
  last_reset_at:     new Date().toISOString(),
}

function recordRejection(reason: string) {
  stats.total_rejected++
  stats.rejection_reasons[reason] = (stats.rejection_reasons[reason] ?? 0) + 1
}

// ── Core validation ───────────────────────────────────────────────────────────
export function validateTask(
  task: TaskRow,
  activePhase: number
): ValidationResult {
  stats.total_validated++

  // roadmap_master tasks always pass — they are already canonical
  if (task.source === 'roadmap_master') {
    stats.total_accepted++
    return { valid: true, phase: 'roadmap_master' }
  }

  // javari_scanner tasks pass — they are CI fix tasks targeting known repos
  if (task.source === 'javari_scanner') {
    stats.total_accepted++
    return { valid: true, phase: 'scanner' }
  }

  // discovery tasks pass — they map to known platform features
  if (task.source === 'discovery') {
    stats.total_accepted++
    return { valid: true, phase: 'discovery' }
  }

  // ── Planner task validation ──────────────────────────────────────────────
  const meta     = task.metadata ?? {}
  const phaseId  = (meta.phase_id as string | undefined) ?? task.phase_id ?? ''
  const module   = (meta.module   as string | undefined) ?? ''
  const titleLow = task.title.toLowerCase()

  // 1. Check direct module match
  const moduleSlug = module.toLowerCase().replace(/[\s-]/g, '_')
  if (moduleSlug && ALL_MODULE_SLUGS.has(moduleSlug)) {
    stats.total_accepted++
    return { valid: true, phase: `module:${moduleSlug}`, module: moduleSlug }
  }

  // 2. Check phase_id prefix against active phase
  if (phaseId) {
    const phaseIdLow = phaseId.toLowerCase()
    for (const [prefix, phases] of Object.entries(ACTIVE_PHASE_PREFIXES)) {
      if (phaseIdLow.startsWith(prefix) || phaseIdLow.includes(prefix.replace('_', ''))) {
        if (phases.includes(activePhase) || phases.includes(activePhase + 1)) {
          stats.total_accepted++
          return { valid: true, phase: phaseIdLow }
        }
      }
    }
    // phase_id exists but doesn't match — check if it contains a known module slug
    for (const slug of ALL_MODULE_SLUGS) {
      if (phaseIdLow.includes(slug) || phaseIdLow.replace(/_/g,'').includes(slug.replace(/_/g,''))) {
        stats.total_accepted++
        return { valid: true, phase: phaseIdLow, module: slug }
      }
    }
  }

  // 3. Title keyword match against module families
  for (const [family, slugs] of Object.entries(CANONICAL_MODULE_FAMILIES)) {
    for (const slug of slugs) {
      const keyword = slug.replace(/_/g, ' ')
      if (titleLow.includes(keyword) || titleLow.includes(slug)) {
        stats.total_accepted++
        return { valid: true, phase: family, module: slug }
      }
    }
  }

  // 4. Reject — no canonical match
  const reason = phaseId
    ? `phase_id '${phaseId}' not in active phase ${activePhase}`
    : 'no phase_id or module match'
  recordRejection(reason)
  return { valid: false, reason }
}

// ── Batch validate (for loop) ─────────────────────────────────────────────────
export function filterToCanonical(
  tasks: TaskRow[],
  activePhase: number
): { accepted: TaskRow[]; rejected: TaskRow[]; rejections: ValidationResult[] } {
  const accepted:   TaskRow[]          = []
  const rejected:   TaskRow[]          = []
  const rejections: ValidationResult[] = []

  for (const task of tasks) {
    const result = validateTask(task, activePhase)
    if (result.valid) {
      accepted.push(task)
    } else {
      rejected.push(task)
      rejections.push(result)
    }
  }

  return { accepted, rejected, rejections }
}

// ── Write rejected tasks to Supabase for drift tracking ──────────────────────
export async function persistRejections(
  rejected: TaskRow[],
  rejections: ValidationResult[]
): Promise<void> {
  if (!rejected.length) return
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
  // Mark rejected tasks as 'blocked' with rejection reason
  const updates = rejected.map((task, i) => ({
    id:         task.id,
    status:     'blocked',
    error:      `canonical_authority: ${rejections[i]?.reason ?? 'no match'}`,
    updated_at: Date.now(),
  }))
  for (const update of updates) {
    await supabase.from('roadmap_tasks')
      .update({ status: update.status, error: update.error, updated_at: update.updated_at })
      .eq('id', update.id)
  }
}

// ── Stats export ─────────────────────────────────────────────────────────────
export function getAuthorityStats(): AuthorityStats {
  return { ...stats }
}

export function resetAuthorityStats(): void {
  stats = {
    total_validated:   0,
    total_accepted:    0,
    total_rejected:    0,
    rejection_reasons: {},
    last_reset_at:     new Date().toISOString(),
  }
}
