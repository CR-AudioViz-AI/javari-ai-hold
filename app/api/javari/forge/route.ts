// app/api/javari/forge/route.ts
// Javari Forge — code generation endpoint.
// POST { prompt, language?, context?, userId? }
// Returns { code, explanation, model, cost }
// Billing gate: free tier = 5 requests/day.
// Credit check: deduct 1 credit per successful generation.
// Thursday, March 19, 2026
import { NextRequest, NextResponse } from 'next/server'
import { route } from '@/lib/javari/model-router'
import { checkGate, trackUsage } from '@/lib/billing/gate'
import { getCreditBalance, deductCredit } from '@/lib/billing/credits'

export const dynamic = 'force-dynamic'

const SYSTEM_FORGE = [
  'You are Javari Forge — an expert code generator.',
  'Mission: "Your Story. Our Design." by CR AudioViz AI.',
  'Produce complete, production-ready code with no placeholders.',
  'Follow TypeScript strict mode, WCAG 2.2 AA, and OWASP Top 10 by default.',
  'Return code first, then a brief explanation below a --- separator.',
  'Never truncate. Never use // TODO or // add logic here.',
].join('\n')

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { prompt, language = 'typescript', context, userId } = body as {
      prompt:    string
      language?: string
      context?:  string
      userId?:   string
    }

    if (!prompt?.trim()) {
      return NextResponse.json({ error: 'prompt required' }, { status: 400 })
    }

    if (userId) {
      // ── Daily rate gate ─────────────────────────────────────────────────
      const gate = await checkGate(userId, 'javari_forge')
      if (!gate.allowed) {
        return NextResponse.json({
          error:       gate.error,
          message:     gate.message,
          upgrade_url: gate.upgrade_url,
          tier:        gate.tier,
          used:        gate.used,
          limit:       gate.limit,
        }, { status: 402 })
      }

      // ── Credit balance check ────────────────────────────────────────────
      const balance = await getCreditBalance(userId)
      if (balance <= 0) {
        return NextResponse.json({
          error:       'no_credits',
          message:     'You are out of credits. Please upgrade.',
          upgrade_url: '/pricing',
        }, { status: 402 })
      }
    }

    const fullPrompt = [
      `Language: ${language}`,
      context ? `Context:\n${context}` : '',
      `Task:\n${prompt}`,
    ].filter(Boolean).join('\n\n')

    const result = await route('coding', fullPrompt, {
      systemPrompt: SYSTEM_FORGE,
      maxTier:      'moderate',
    })

    if (result.blocked) {
      return NextResponse.json({ error: result.reason, blocked: true }, { status: 429 })
    }

    const parts       = result.content.split(/^---$/m)
    const code        = parts[0]?.trim() ?? result.content
    const explanation = parts[1]?.trim() ?? ''

    // ── Post-success tracking (fire-and-forget, only on success) ───────────
    trackUsage(userId, 'javari_forge').catch(() => {})
    deductCredit(userId, 'javari_forge').catch(() => {})

    return NextResponse.json({
      code,
      explanation,
      language,
      model:    result.model,
      provider: result.provider,
      tier:     result.tier,
      cost:     result.cost,
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function GET() {
  return NextResponse.json({
    service:  'Javari Forge',
    version:  '1.0',
    endpoint: 'POST /api/javari/forge',
    params:   ['prompt (required)', 'language (default: typescript)', 'context', 'userId'],
    limits:   { free: '5/day', pro: '100/day', power: 'unlimited' },
  })
}
