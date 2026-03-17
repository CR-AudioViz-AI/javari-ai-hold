/**
 * middleware.ts
 * Javari AI — Auth + Route Detection Middleware
 *
 * 1. Protects authenticated routes — redirects to /login if no session
 * 2. Redirects authenticated users away from /login and /signup to /javari
 * 3. Sets x-is-javari header for conditional nav rendering
 *
 * @version 2.0.0 — added Supabase session-based auth guard
 * @date 2026-03-09
 */

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

// Routes that require authentication
const PROTECTED_PREFIXES = [
  "/javari",
  "/command-center",
  "/dashboard",
  "/account",
  "/admin",
  "/settings",
  "/analytics",
  "/chat",
  "/tools",
  "/projects",
  "/marketplace",
  "/store",
];

// Routes that should redirect to /javari if already authenticated
const AUTH_ROUTES = ["/login", "/signup"];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // ── Build Supabase server client from request cookies ──────────────────
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Get session (lightweight JWT check — no round-trip)
  const { data: { session } } = await supabase.auth.getSession();
  const isAuthenticated = !!session;

  // ── Auth route guard — redirect authenticated users away from login/signup
  if (AUTH_ROUTES.some(r => pathname.startsWith(r))) {
    if (isAuthenticated) {
      return NextResponse.redirect(new URL("/javari",
  "/command-center", request.url));
    }
    response.headers.set("x-is-javari", "false");
    return response;
  }

  // ── Protected route guard — redirect unauthenticated users to /login ───
  const isProtected = PROTECTED_PREFIXES.some(p => pathname.startsWith(p));
  if (isProtected && !isAuthenticated) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  // ── Javari route header — for conditional nav rendering ────────────────
  response.headers.set(
    "x-is-javari",
    pathname.startsWith("/javari") ? "true" : "false"
  );

  return response;
}

export const config = {
  matcher: [
    "/((?!api/|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
