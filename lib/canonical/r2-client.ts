// lib/canonical/r2-client.ts
// Cloudflare R2 client — S3-compatible REST API, no AWS SDK dependency
// Implements: listCanonicalKeys, fetchCanonicalText, checkR2Connectivity
// Uses env vars: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY,
//                R2_ENDPOINT, R2_CANONICAL_BUCKET, R2_CANONICAL_PREFIX
// Tuesday, March 17, 2026
import crypto from 'crypto'

// ── Config ────────────────────────────────────────────────────────────────────
function cfg() {
  const accountId  = process.env.R2_ACCOUNT_ID        ?? ''
  const accessKey  = process.env.R2_ACCESS_KEY_ID     ?? ''
  const secretKey  = process.env.R2_SECRET_ACCESS_KEY ?? ''
  // Endpoint: either explicit R2_ENDPOINT or constructed from account ID
  const endpoint   = process.env.R2_ENDPOINT
    ?? `https://${accountId}.r2.cloudflarestorage.com`
  const bucket     = process.env.R2_CANONICAL_BUCKET  ?? process.env.R2_BUCKET ?? ''
  const prefix     = process.env.R2_CANONICAL_PREFIX  ?? 'consolidation-docs/'
  const maxRetries = parseInt(process.env.R2_MAX_RETRIES ?? '3', 10)
  const timeout    = parseInt(process.env.R2_TIMEOUT    ?? '30000', 10)

  return { accountId, accessKey, secretKey, endpoint, bucket, prefix, maxRetries, timeout }
}

// ── AWS Signature V4 ──────────────────────────────────────────────────────────
function hmacSha256(key: Buffer | string, data: string): Buffer {
  return crypto.createHmac('sha256', key).update(data, 'utf8').digest()
}

function sha256Hex(data: string): string {
  return crypto.createHash('sha256').update(data, 'utf8').digest('hex')
}

function getSigningKey(secretKey: string, date: string, region: string, service: string): Buffer {
  const kDate    = hmacSha256(`AWS4${secretKey}`, date)
  const kRegion  = hmacSha256(kDate, region)
  const kService = hmacSha256(kRegion, service)
  return hmacSha256(kService, 'aws4_request')
}

interface SignedHeaders {
  Authorization:        string
  'x-amz-date':        string
  'x-amz-content-sha256': string
  host:                 string
}

function signRequest(
  method: string,
  url: string,
  body: string = '',
): SignedHeaders {
  const c = cfg()
  const parsed   = new URL(url)
  const host     = parsed.host
  const pathname = parsed.pathname
  const query    = parsed.searchParams.toString()

  const now      = new Date()
  const amzDate  = now.toISOString().replace(/[:\-]|\.\d{3}/g, '').slice(0, 15) + 'Z'
  const dateStamp = amzDate.slice(0, 8)

  const payloadHash     = sha256Hex(body)
  const signedHeaders   = 'host;x-amz-content-sha256;x-amz-date'
  const canonicalHeaders = `host:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`

  // Sort query params
  const sortedQuery = query
    ? query.split('&').sort().join('&')
    : ''

  const canonicalRequest = [
    method,
    pathname,
    sortedQuery,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n')

  const region        = 'auto'
  const service       = 's3'
  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`
  const stringToSign  = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join('\n')

  const signingKey  = getSigningKey(c.secretKey, dateStamp, region, service)
  const signature   = hmacSha256(signingKey, stringToSign).toString('hex')

  return {
    Authorization: `AWS4-HMAC-SHA256 Credential=${c.accessKey}/${credentialScope},SignedHeaders=${signedHeaders},Signature=${signature}`,
    'x-amz-date': amzDate,
    'x-amz-content-sha256': payloadHash,
    host,
  }
}

// ── Low-level R2 fetch ────────────────────────────────────────────────────────
async function r2Fetch(
  method: string,
  path: string,
  query: Record<string, string> = {},
  body: string = '',
): Promise<Response> {
  const c  = cfg()
  const qs = Object.keys(query).length
    ? '?' + new URLSearchParams(query).toString()
    : ''
  const url  = `${c.endpoint}/${c.bucket}${path}${qs}`
  const hdrs = signRequest(method, url, body)

  const controller = new AbortController()
  const timer      = setTimeout(() => controller.abort(), c.timeout)

  try {
    const res = await fetch(url, {
      method,
      headers: {
        ...hdrs,
        Accept: 'application/xml,text/plain,*/*',
      },
      body: body || undefined,
      signal: controller.signal,
    })
    return res
  } finally {
    clearTimeout(timer)
  }
}

// ── Types ─────────────────────────────────────────────────────────────────────
export interface R2Object {
  key:          string
  size:         number
  lastModified: string
  etag:         string
}

export interface ConnectivityResult {
  ok:       boolean
  bucket:   string
  endpoint: string
  prefix:   string
  error?:   string
}

// ── Parse S3 ListObjectsV2 XML ────────────────────────────────────────────────
function parseListXml(xml: string): R2Object[] {
  const objects: R2Object[] = []
  // Simple regex-based XML parser — avoids DOM dependency in edge runtime
  const keyRe          = /<Key>([\s\S]*?)<\/Key>/g
  const sizeRe         = /<Size>([\s\S]*?)<\/Size>/g
  const lastModRe      = /<LastModified>([\s\S]*?)<\/LastModified>/g
  const etagRe         = /<ETag>([\s\S]*?)<\/ETag>/g

  const keys      = [...xml.matchAll(keyRe)].map(m => m[1].trim())
  const sizes     = [...xml.matchAll(sizeRe)].map(m => parseInt(m[1].trim(), 10))
  const lastMods  = [...xml.matchAll(lastModRe)].map(m => m[1].trim())
  const etags     = [...xml.matchAll(etagRe)].map(m => m[1].trim().replace(/"/g, ''))

  for (let i = 0; i < keys.length; i++) {
    objects.push({
      key:          keys[i],
      size:         sizes[i] ?? 0,
      lastModified: lastMods[i] ?? '',
      etag:         etags[i]    ?? '',
    })
  }
  return objects
}

// ── Public: listCanonicalKeys ─────────────────────────────────────────────────
// Lists all objects under R2_CANONICAL_PREFIX (defaults to consolidation-docs/)
export async function listCanonicalKeys(prefixOverride?: string): Promise<R2Object[]> {
  const c      = cfg()
  const prefix = prefixOverride ?? c.prefix
  let   token  = ''
  const all: R2Object[] = []

  // Paginate using continuation tokens
  for (let page = 0; page < 20; page++) {
    const query: Record<string, string> = {
      'list-type': '2',
      prefix,
      'max-keys':  '1000',
    }
    if (token) query['continuation-token'] = token

    const res  = await r2Fetch('GET', '', query)
    const text = await res.text()

    if (!res.ok) {
      throw new Error(`R2 list failed: ${res.status} ${res.statusText}\n${text.slice(0, 500)}`)
    }

    const objects = parseListXml(text)
    all.push(...objects)

    // Check for truncation
    const isTruncated = /<IsTruncated>true<\/IsTruncated>/i.test(text)
    if (!isTruncated) break

    const tokenMatch = text.match(/<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/)
    if (!tokenMatch) break
    token = tokenMatch[1]
  }

  return all
}

// ── Public: fetchCanonicalText ────────────────────────────────────────────────
// Fetches the text content of a single R2 object by key
export async function fetchCanonicalText(key: string): Promise<string> {
  const res = await r2Fetch('GET', `/${encodeURIComponent(key).replace(/%2F/g, '/')}`)
  if (!res.ok) {
    throw new Error(`R2 fetch failed for ${key}: ${res.status} ${res.statusText}`)
  }
  return await res.text()
}

// ── Public: checkR2Connectivity ───────────────────────────────────────────────
// Validates bucket access — used by ingest.ts as Step 1
export async function checkR2Connectivity(): Promise<ConnectivityResult> {
  const c = cfg()
  if (!c.accountId || !c.accessKey || !c.secretKey || !c.bucket) {
    return {
      ok:       false,
      bucket:   c.bucket || '(missing)',
      endpoint: c.endpoint,
      prefix:   c.prefix,
      error:    `Missing R2 credentials: accountId=${!!c.accountId} accessKey=${!!c.accessKey} secretKey=${!!c.secretKey} bucket=${!!c.bucket}`,
    }
  }

  try {
    // List up to 1 object to verify connectivity
    const query: Record<string, string> = {
      'list-type': '2',
      prefix:      c.prefix,
      'max-keys':  '1',
    }
    const res = await r2Fetch('GET', '', query)
    if (!res.ok) {
      const body = await res.text()
      return {
        ok:       false,
        bucket:   c.bucket,
        endpoint: c.endpoint,
        prefix:   c.prefix,
        error:    `${res.status} ${res.statusText}: ${body.slice(0, 200)}`,
      }
    }
    const text    = await res.text()
    const objects = parseListXml(text)
    return {
      ok:       true,
      bucket:   c.bucket,
      endpoint: c.endpoint,
      prefix:   c.prefix,
    }
  } catch (err: unknown) {
    return {
      ok:       false,
      bucket:   c.bucket,
      endpoint: c.endpoint,
      prefix:   c.prefix,
      error:    err instanceof Error ? err.message : String(err),
    }
  }
}

// ── Legacy compat exports (used by existing routes) ───────────────────────────
export async function listRoadmapDocs(): Promise<R2Object[]> {
  return listCanonicalKeys()
}

export { R2Object as default }
