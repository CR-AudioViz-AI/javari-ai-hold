// lib/javari/architectureGuard.ts
// Javari Architecture Guard — enforces structural rules across the platform
// Prevents duplicate modules, orphan features, naming drift.
// Tuesday, March 17, 2026

// ── Naming conventions ────────────────────────────────────────────────────────
const ROUTE_PATTERNS = {
  api_autonomy:  /^\/api\/autonomy\//,
  api_javari:    /^\/api\/javari\//,
  api_internal:  /^\/api\/internal\//,
  page_javari:   /^\/javari\//,
  page_command:  /^\/command\//,
  page_admin:    /^\/admin\//,
} as const

// Registered canonical routes — any new route must be added here before use
const ROUTE_REGISTRY = new Set([
  // Autonomy API
  '/api/autonomy/loop',
  '/api/autonomy/pr-workflow',
  '/api/autonomy/pr-merge',
  '/api/autonomy/scan',
  '/api/autonomy/status',
  // Javari API
  '/api/javari/chat',
  '/api/javari/team',
  '/api/javari/worker',
  '/api/javari/test',
  '/api/javari/roadmap',
  '/api/javari/queue',
  '/api/javari/learning/update',
  // Internal
  '/api/internal/vault-sync',
  '/api/internal/deploy-promote',
  // Pages
  '/javari',
  '/javari/command-center',
  '/javari/roadmap',
  '/javari/chat',
  '/javari/multi-ai',
  '/javari/autonomy-graph',
  '/command',
  '/command/status',
  '/command/history',
  '/command/control',
])

// Canonical file naming rules
const NAMING_RULES: Array<{ pattern: RegExp; rule: string }> = [
  { pattern: /[A-Z]/, rule: 'Route files must be lowercase (page.tsx, route.ts)' },
  { pattern: /\s/,    rule: 'No spaces in file or directory names' },
  { pattern: /--/,    rule: 'No double-hyphens in names' },
]

// ── Validation functions ──────────────────────────────────────────────────────
export function isRegisteredRoute(path: string): boolean {
  // Exact match or prefix match for dynamic segments
  if (ROUTE_REGISTRY.has(path)) return true
  // Allow dynamic routes like /javari/[id] if base is registered
  const base = path.replace(/\/\[.*?\]/g, '').replace(/\/$/, '')
  return ROUTE_REGISTRY.has(base)
}

export function validateFileName(name: string): { valid: boolean; violations: string[] } {
  const violations: string[] = []
  // Only check route/page files, not component files
  for (const { pattern, rule } of NAMING_RULES) {
    if (name !== 'page.tsx' && name !== 'route.ts' && name !== 'layout.tsx') {
      // Component files can use PascalCase — skip
      continue
    }
    if (pattern.test(name)) violations.push(rule)
  }
  return { valid: violations.length === 0, violations }
}

export function checkNamingConvention(identifier: string): boolean {
  // Identifiers (module names, task IDs) must use snake_case or kebab-case
  return /^[a-z][a-z0-9_-]*$/.test(identifier)
}

export function registerRoute(path: string): void {
  ROUTE_REGISTRY.add(path)
}

export function getRouteRegistry(): string[] {
  return Array.from(ROUTE_REGISTRY).sort()
}

// ── Module deduplication ──────────────────────────────────────────────────────
// Tracks modules that have been built in this session to prevent duplicates
const builtModules = new Map<string, { built_at: string; task_id: string }>()

export function checkDuplicate(moduleKey: string): { isDuplicate: boolean; original?: string } {
  const existing = builtModules.get(moduleKey)
  if (existing) {
    return { isDuplicate: true, original: existing.task_id }
  }
  return { isDuplicate: false }
}

export function registerModule(moduleKey: string, taskId: string): void {
  builtModules.set(moduleKey, { built_at: new Date().toISOString(), task_id: taskId })
}

export function getBuiltModules(): Record<string, { built_at: string; task_id: string }> {
  return Object.fromEntries(builtModules)
}

// ── Guard report ──────────────────────────────────────────────────────────────
export interface GuardReport {
  registered_routes:     number
  built_modules:         number
  naming_rules:          number
  last_checked_at:       string
}

export function getGuardReport(): GuardReport {
  return {
    registered_routes: ROUTE_REGISTRY.size,
    built_modules:     builtModules.size,
    naming_rules:      NAMING_RULES.length,
    last_checked_at:   new Date().toISOString(),
  }
}
