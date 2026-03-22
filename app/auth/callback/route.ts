// app/auth/callback/route.ts
// Supabase OAuth callback — javari-ai.
// Handles code exchange, profile creation, and signup credit grant.
// After this route: user has a session cookie, userId is available to all
// billing routes via supabase.auth.getUser() in enforcePrecheck().
// Updated: March 21, 2026 — OAuth auth system.
import { NextRequest, NextResponse } from 'next/server'
import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'

export const dynamic = 'force-dynamic'
export const runtime  = 'nodejs'

function serviceDb() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url)
  const code       = requestUrl.searchParams.get('code')
  const redirectTo = requestUrl.searchParams.get('redirect_to') ?? '/javari'
  const baseUrl    = process.env.NEXT_PUBLIC_APP_URL ?? 'https://javari-ai.vercel.app'

  if (!code) {
    console.error('[auth/callback] no code received')
    return NextResponse.redirect(`${baseUrl}/login?error=missing_code`)
  }

  // ── Cookie-aware client for session persistence ────────────────────────────
  const cookieStore = cookies()
  const supabase    = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get:    (name)          => cookieStore.get(name)?.value,
        set:    (name, value, options: CookieOptions) => { try { cookieStore.set({ name, value, ...options }) } catch {} },
        remove: (name, options: CookieOptions) => { try { cookieStore.set({ name, value: '', ...options }) } catch {} },
      },
    }
  )

  const { data: { session }, error } = await supabase.auth.exchangeCodeForSession(code)

  if (error || !session) {
    console.error('[auth/callback] session exchange failed:', error?.message)
    return NextResponse.redirect(
      `${baseUrl}/login?error=${encodeURIComponent(error?.message ?? 'auth_failed')}`
    )
  }

  const { user } = session
  const db       = serviceDb()

  // ── Profile upsert — safe on every callback ───────────────────────────────
  await db.from('profiles').upsert({
    id:         user.id,
    email:      user.email,
    full_name:  user.user_metadata?.full_name  ?? user.user_metadata?.name ?? null,
    avatar_url: user.user_metadata?.avatar_url ?? null,
    provider:   user.app_metadata?.provider    ?? 'unknown',
    updated_at: new Date().toISOString(),
  }, { onConflict: 'id', ignoreDuplicates: false }).then(({ error: e }) => {
    if (e) console.error('[auth/callback] profile upsert failed:', e.message)
  })

  // ── Signup credit grant — only once per user ──────────────────────────────
  const { count } = await db
    .from('usage_ledger')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .eq('feature', 'credits')
    .eq('metadata->>source', 'signup_bonus')

  if (count === 0) {
    await db.from('usage_ledger').insert({
      user_id:     user.id,
      feature:     'credits',
      usage_count: 25,
      metadata:    { type: 'grant', source: 'signup_bonus', provider: user.app_metadata?.provider },
    })
    console.log(`[auth/callback] 25 signup credits granted: ${user.id.slice(0,8)}…`)
  }

  const destination = redirectTo.startsWith('http') ? redirectTo : `${baseUrl}${redirectTo}`
  return NextResponse.redirect(destination)
}
