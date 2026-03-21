// app/api/javari/forge/route.ts
// Javari Forge — code generation endpoint.
// POST { prompt, language?, context?, userId? }
// Returns { code, explanation, model, cost }
// Billing gate: free tier = 5 requests/day.
// Credit cost: 3 credits per generation (CREDIT_COSTS.javari_forge).
// Updated: March 21, 2026 — Credit enforcement audit.
import { NextRequest, NextResponse } from 'next/server'
import { route } from '@/lib/javari/model-router'
import { checkGate, trackUsage } from '@/lib/billing/gate'
import { getCreditBalance, deductCredits, CREDIT_COSTS } from '@/lib/billing/credits'

export const dynamic = 'force-dynamic'

const SYSTEM_FORGE = [
  'You are Javari Forge — an expert code generator.',
  'Mission: "Your Story. Our Design." by CR AudioViz AI.',
  'Produce complete, production-ready code with no placeholders.',
  'Follow TypeScript strict mode, WCAG 2.2 AA, and OWASP Top 10 by default.',
  'Return code first, then a brief explanation below a --- separator.',
  'Never truncate. Never use // TODO or // add logic here.',
].join('\n')

const ROUTE_COST = CREDIT_COSTS.javari_forge  // 3 credits

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

      // ── Credit balance check (pre-execution, exact cost) ────────────────
      const balance = await getCreditBalance(userId)
      if (balance < ROUTE_COST) {
        return NextResponse.json({
          error:       'no_credits',
          message:     `Code generation costs ${ROUTE_COST} credits. You have ${balance}. Please upgrade.`,
          required:    ROUTE_COST,
          available:   balance,
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

    // ── Post-success deduction ──────────────────────────────────────────────
    if (userId) {
      trackUsage(userId, 'javari_forge').catch(() => {})
      deductCredits(userId, ROUTE_COST, 'javari_forge').catch(() => {})
    }

    return NextResponse.json({
      code,
      explanation,
      language,
      model:        result.model,
      provider:     result.provider,
      tier:         result.tier,
      cost:         result.cost,
      credits_used: ROUTE_COST,
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function GET() {
  return NextResponse.json({
    service:      'Javari Forge',
    version:      '1.1',
    endpoint:     'POST /api/javari/forge',
    params:       ['prompt (required)', 'language (default: typescript)', 'context', 'userId'],
    credits_cost: ROUTE_COST,
    limits:       { free: '5/day', pro: '100/day', premium: '500/day' },
  })
}
