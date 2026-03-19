// app/api/billing/webhook/route.ts
// MIGRATED: All billing logic lives in craudiovizai.com.
// This stub permanently redirects to the central billing authority.
// javari-ai contains ZERO billing logic.
// Thursday, March 19, 2026
import { NextRequest, NextResponse } from 'next/server'
export const dynamic = 'force-dynamic'
const BILLING_BASE = process.env.BILLING_SERVICE_URL ?? 'https://craudiovizai.com'
export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams.toString()
  return NextResponse.redirect(
    `${BILLING_BASE}/api/billing/webhook${params ? '?' + params : ''}`, 308
  )
}
export async function POST(req: NextRequest) {
  return NextResponse.redirect(`${BILLING_BASE}/api/billing/webhook`, 308)
}
