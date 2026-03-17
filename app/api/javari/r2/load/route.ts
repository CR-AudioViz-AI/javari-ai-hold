// app/api/javari/r2/load/route.ts
// Loads canonical documents from R2 and stores them in canonical_docs table
// POST /api/javari/r2/load  — runs full ingestion pipeline
// GET  /api/javari/r2/load  — returns ingestion status
// Tuesday, March 17, 2026
import { NextRequest, NextResponse } from 'next/server'
import { listCanonicalKeys, fetchCanonicalText, checkR2Connectivity } from '@/lib/canonical/r2-client'
import { createClient } from '@supabase/supabase-js'
import crypto from 'crypto'

export const dynamic    = 'force-dynamic'
export const runtime    = 'nodejs'
export const maxDuration = 60

function db() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

function sha256Hex(text: string): string {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex')
}

function extractTitle(text: string, key: string): string {
  // Try to extract from first # heading
  const headingMatch = text.match(/^#\s+(.+)/m)
  if (headingMatch) return headingMatch[1].trim()
  // Fall back to filename without extension
  return (key.split('/').pop() ?? key).replace(/\.(md|txt)$/, '').replace(/[_-]/g, ' ')
}

// ── GET — ingestion status ────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization') ?? ''
  const cron = process.env.CRON_SECRET ?? 'javari-cron-2025-phase2-autonomous'
  if (!auth.includes(cron)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const supabase = db()

    const { data: docs, error } = await supabase
      .from('canonical_docs')
      .select('id, title, source_key, doc_type, size_bytes, ingested_at, updated_at')
      .order('source_key', { ascending: true })

    if (error) throw new Error(error.message)

    const { count } = await supabase
      .from('canonical_doc_chunks')
      .select('*', { count: 'exact', head: true })

    return NextResponse.json({
      ok:           true,
      docs_ingested: docs?.length ?? 0,
      total_chunks:  count ?? 0,
      docs:         (docs ?? []).map(d => ({
        title:        d.title,
        source_key:   d.source_key,
        size_bytes:   d.size_bytes,
        ingested_at:  d.ingested_at,
      })),
      timestamp:    new Date().toISOString(),
    })
  } catch (err: unknown) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 })
  }
}

// ── POST — run ingestion ──────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const auth = req.headers.get('authorization') ?? ''
  const cron = process.env.CRON_SECRET ?? 'javari-cron-2025-phase2-autonomous'
  if (!auth.includes(cron)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body   = await req.json().catch(() => ({})) as Record<string, unknown>
  const force  = body.force === true         // re-ingest even if unchanged
  const dryRun = body.dry_run === true       // list + parse but no writes
  const maxDocs = typeof body.max_docs === 'number' ? body.max_docs : 100

  const results: Array<{
    key:      string
    title:    string
    status:   'ingested' | 'skipped' | 'failed' | 'dry_run'
    size:     number
    error?:   string
  }> = []

  try {
    const supabase = db()

    // Step 1 — verify R2 connectivity
    const conn = await checkR2Connectivity()
    if (!conn.ok) {
      return NextResponse.json({
        ok:    false,
        error: `R2 connectivity failed: ${conn.error}`,
        config: { bucket: conn.bucket, endpoint: conn.endpoint, prefix: conn.prefix },
      }, { status: 503 })
    }

    // Step 2 — list docs from R2 (md/txt only)
    const allObjects = await listCanonicalKeys()
    const docObjects = allObjects
      .filter(o => o.key.endsWith('.md') || o.key.endsWith('.txt'))
      .slice(0, maxDocs)

    if (docObjects.length === 0) {
      return NextResponse.json({
        ok:      false,
        error:   `No markdown/text documents found under prefix: ${conn.prefix}`,
        bucket:  conn.bucket,
        prefix:  conn.prefix,
        total_objects: allObjects.length,
      }, { status: 404 })
    }

    // Step 3 — ingest each document
    for (const obj of docObjects) {
      try {
        // Fetch text from R2
        const text = await fetchCanonicalText(obj.key)
        const hash = sha256Hex(text)

        // Diff check — skip if unchanged and not forced
        if (!force && !dryRun) {
          const { data: existing } = await supabase
            .from('canonical_docs')
            .select('id, sha256')
            .eq('source_key', obj.key)
            .single()

          if (existing?.sha256 === hash) {
            results.push({ key: obj.key, title: extractTitle(text, obj.key), status: 'skipped', size: obj.size })
            continue
          }
        }

        const title = extractTitle(text, obj.key)

        if (dryRun) {
          results.push({ key: obj.key, title, status: 'dry_run', size: obj.size })
          continue
        }

        // Upsert canonical_docs
        const { error: upsertErr } = await supabase
          .from('canonical_docs')
          .upsert({
            source_key:   obj.key,
            title,
            doc_type:     obj.key.endsWith('.md') ? 'markdown' : 'text',
            content:      text.slice(0, 50000),  // store up to 50KB inline
            sha256:       hash,
            size_bytes:   obj.size,
            last_modified: obj.lastModified,
            ingested_at:  new Date().toISOString(),
            updated_at:   new Date().toISOString(),
            metadata: {
              etag:    obj.etag,
              bucket:  conn.bucket,
              prefix:  conn.prefix,
              r2_key:  obj.key,
            },
          }, { onConflict: 'source_key' })

        if (upsertErr) throw new Error(`Upsert failed: ${upsertErr.message}`)

        results.push({ key: obj.key, title, status: 'ingested', size: obj.size })

      } catch (docErr: unknown) {
        const msg = docErr instanceof Error ? docErr.message : String(docErr)
        results.push({ key: obj.key, title: obj.key, status: 'failed', size: obj.size, error: msg })
      }
    }

    const ingested = results.filter(r => r.status === 'ingested').length
    const skipped  = results.filter(r => r.status === 'skipped').length
    const failed   = results.filter(r => r.status === 'failed').length
    const dry_ran  = results.filter(r => r.status === 'dry_run').length
    const totalBytes = results.reduce((s, r) => s + (r.size ?? 0), 0)

    return NextResponse.json({
      ok:            true,
      dry_run:       dryRun,
      bucket:        conn.bucket,
      prefix:        conn.prefix,
      total_in_r2:   allObjects.length,
      md_docs_found: docObjects.length,
      ingested,
      skipped,
      failed,
      dry_run_count: dry_ran,
      total_bytes:   totalBytes,
      total_mb:      Math.round(totalBytes / 1024 / 1024 * 100) / 100,
      results:       results.map(r => ({
        name:   r.key.split('/').pop() ?? r.key,
        status: r.status,
        size:   r.size,
        error:  r.error,
      })),
      // Sample preview of first successfully ingested doc
      sample_preview: results
        .filter(r => r.status === 'ingested')
        .slice(0, 1)
        .map(r => ({ key: r.key, title: r.title, size_bytes: r.size })),
      timestamp: new Date().toISOString(),
    })

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ ok: false, error: msg, timestamp: new Date().toISOString() }, { status: 500 })
  }
}
