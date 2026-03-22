// lib/supabase/client.ts
// Supabase browser client — singleton for client components.
// Uses @supabase/ssr createBrowserClient which handles cookie-based sessions.
// This is the client used in login pages and client components.
// Updated: March 21, 2026 — OAuth auth system.
import { createBrowserClient } from '@supabase/ssr'

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  )
}

// Named export for direct use in components
export const supabase = createClient()
