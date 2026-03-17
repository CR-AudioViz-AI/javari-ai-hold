// app/api/javari/r2/diag/route.ts
// R2 diagnostics — reads env vars from inside the running function
// Masks secrets but shows first 8 chars for verification
// Tuesday, March 17, 2026
import { NextRequest, NextResponse } from 'next/server'

export const dynamic    = 'force-dynamic'
export const runtime    = 'nodejs'
export const maxDuration = 10

function mask(val: string | undefined, show = 8): string {
  if (!val) return '(empty)'
  if (val.length <= show) return val
  return val.slice(0, show) + '...' + `[${val.length} chars]`
}

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization') ?? ''
  if (!auth.includes(process.env.CRON_SECRET ?? 'javari-cron-2025-phase2-autonomous')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const accountId  = process.env.R2_ACCOUNT_ID        ?? ''
  const accessKey  = process.env.R2_ACCESS_KEY_ID     ?? ''
  const secretKey  = process.env.R2_SECRET_ACCESS_KEY ?? ''
  const endpoint   = process.env.R2_ENDPOINT          ?? ''
  const bucket     = process.env.R2_CANONICAL_BUCKET  ?? process.env.R2_BUCKET ?? ''
  const prefix     = process.env.R2_CANONICAL_PREFIX  ?? 'consolidation-docs/'

  // Attempt a raw unsigned HEAD to see if bucket is reachable
  const testUrl = endpoint
    ? `${endpoint}/${bucket}?list-type=2&prefix=${encodeURIComponent(prefix)}&max-keys=1`
    : ''

  return NextResponse.json({
    env: {
      R2_ACCOUNT_ID:       mask(accountId),
      R2_ACCESS_KEY_ID:    mask(accessKey),
      R2_SECRET_ACCESS_KEY: mask(secretKey, 4),
      R2_ENDPOINT:         endpoint || '(not set)',
      R2_CANONICAL_BUCKET: bucket   || '(not set)',
      R2_BUCKET:           process.env.R2_BUCKET ?? '(not set)',
      R2_CANONICAL_PREFIX: prefix,
      R2_PUBLIC_CDN_URL:   process.env.R2_PUBLIC_CDN_URL ?? '(not set)',
    },
    // Key format checks
    analysis: {
      accountId_is_hex:    /^[0-9a-f]{32}$/.test(accountId),
      accountId_is_base64: accountId.startsWith('eyJ'),
      accessKey_looks_real: accessKey.length > 10 && !accessKey.startsWith('eyJ'),
      endpoint_is_r2:      endpoint.includes('.r2.cloudflarestorage.com'),
      endpoint_has_account: endpoint.includes(accountId.slice(0,8)),
      bucket_set:          !!bucket,
    },
    timestamp: new Date().toISOString(),
  })
}
