// app/api/javari/r2/list/route.ts
// Lists all canonical documents in Cloudflare R2 bucket
// GET /api/javari/r2/list
// Tuesday, March 17, 2026
import { NextRequest, NextResponse } from 'next/server'
import { listCanonicalKeys, checkR2Connectivity } from '@/lib/canonical/r2-client'

export const dynamic    = 'force-dynamic'
export const runtime    = 'nodejs'
export const maxDuration = 30

export async function GET(req: NextRequest) {
  // Auth check
  const auth = req.headers.get('authorization') ?? ''
  const cron = process.env.CRON_SECRET ?? 'javari-cron-2025-phase2-autonomous'
  if (!auth.includes(cron)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    // Check connectivity first
    const connectivity = await checkR2Connectivity()
    if (!connectivity.ok) {
      return NextResponse.json({
        ok:    false,
        error: `R2 connectivity failed: ${connectivity.error}`,
        config: {
          bucket:   connectivity.bucket,
          endpoint: connectivity.endpoint,
          prefix:   connectivity.prefix,
        },
      }, { status: 503 })
    }

    // List all objects
    const objects = await listCanonicalKeys()

    // Separate markdown docs from other files
    const mdDocs    = objects.filter(o => o.key.endsWith('.md') || o.key.endsWith('.txt'))
    const nonMdDocs = objects.filter(o => !o.key.endsWith('.md') && !o.key.endsWith('.txt'))

    // Sort by key
    mdDocs.sort((a, b) => a.key.localeCompare(b.key))

    const totalBytes = objects.reduce((s, o) => s + o.size, 0)

    return NextResponse.json({
      ok:            true,
      bucket:        connectivity.bucket,
      prefix:        connectivity.prefix,
      total_objects: objects.length,
      md_docs:       mdDocs.length,
      other_files:   nonMdDocs.length,
      total_bytes:   totalBytes,
      total_mb:      Math.round(totalBytes / 1024 / 1024 * 100) / 100,
      documents:     mdDocs.map(o => ({
        key:           o.key,
        name:          o.key.split('/').pop() ?? o.key,
        size_bytes:    o.size,
        last_modified: o.lastModified,
        etag:          o.etag,
      })),
      other:         nonMdDocs.map(o => ({
        key:  o.key,
        size: o.size,
      })),
      timestamp: new Date().toISOString(),
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({
      ok:    false,
      error: msg,
      timestamp: new Date().toISOString(),
    }, { status: 500 })
  }
}
