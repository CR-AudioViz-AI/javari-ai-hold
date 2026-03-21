// components/billing/UpsellModal.tsx
// Credit pack upsell modal — shown when Javari routes return upsell.show === true.
// Handles both low_credits (proactive) and out_of_credits (blocked) states.
// Calls POST /api/billing/checkout (craudiovizai) and redirects to Stripe.
// Updated: March 21, 2026 — Initial implementation.
'use client'

import { useState } from 'react'
import { CREDIT_PACKS, type PackKey, type UpsellPayload } from '@/lib/billing/upsell'

interface UpsellModalProps {
  upsell:    UpsellPayload
  userId:    string
  userEmail: string
  onClose:   () => void
}

const BILLING_BASE = process.env.NEXT_PUBLIC_BILLING_URL ?? 'https://craudiovizai.com'

export function UpsellModal({ upsell, userId, userEmail, onClose }: UpsellModalProps) {
  const [loading, setLoading] = useState<PackKey | null>(null)
  const [error,   setError]   = useState<string | null>(null)

  const isBlocked = upsell.type === 'out_of_credits'

  async function handleBuyCredits(packKey: PackKey) {
    setLoading(packKey)
    setError(null)

    try {
      const pack = CREDIT_PACKS[packKey]
      const res  = await fetch(`${BILLING_BASE}/api/billing/checkout`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          priceId:    pack.priceId,
          userId,
          email:      userEmail,
          mode:       'payment',
          successUrl: `${BILLING_BASE}/account/credits?success=1&pack=${packKey}`,
          cancelUrl:  `${window.location.href}?upsell_canceled=1`,
        }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error ?? `HTTP ${res.status}`)
      }

      const { url } = await res.json()
      if (!url) throw new Error('No checkout URL returned')

      window.location.href = url

    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Checkout failed. Please try again.')
      setLoading(null)
    }
  }

  function handleUpgradePlan() {
    window.location.href = `${BILLING_BASE}/pricing`
  }

  return (
    // ── Backdrop ─────────────────────────────────────────────────────────────
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={(e) => { if (e.target === e.currentTarget && !isBlocked) onClose() }}
    >
      <div className="relative w-full max-w-md rounded-2xl bg-white shadow-2xl overflow-hidden">

        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div className={`px-6 pt-6 pb-4 ${isBlocked ? 'bg-red-50' : 'bg-amber-50'}`}>
          <div className="flex items-start justify-between">
            <div>
              <div className={`text-2xl mb-1 ${isBlocked ? '' : ''}`}>
                {isBlocked ? '⚡' : '💡'}
              </div>
              <h2 className="text-lg font-bold text-gray-900">
                {isBlocked ? "You're out of credits" : "Running low on credits"}
              </h2>
              <p className="text-sm text-gray-600 mt-0.5">{upsell.message}</p>
            </div>
            {!isBlocked && (
              <button
                onClick={onClose}
                className="text-gray-400 hover:text-gray-600 transition ml-4 mt-0.5 flex-shrink-0"
                aria-label="Close"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        </div>

        {/* ── Pack options ────────────────────────────────────────────────── */}
        <div className="px-6 py-4 space-y-2">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">
            Top up your credits
          </p>

          {upsell.packs.map((packKey) => {
            const pack        = CREDIT_PACKS[packKey]
            const isRec       = packKey === upsell.recommended_pack
            const isLoading   = loading === packKey

            return (
              <button
                key={packKey}
                onClick={() => handleBuyCredits(packKey)}
                disabled={loading !== null}
                className={`
                  w-full flex items-center justify-between rounded-xl px-4 py-3 text-left
                  transition border-2 relative
                  ${isRec
                    ? 'border-indigo-500 bg-indigo-50 hover:bg-indigo-100'
                    : 'border-gray-200 bg-gray-50 hover:bg-gray-100 hover:border-gray-300'
                  }
                  ${loading !== null ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}
                `}
              >
                {/* Badge */}
                {pack.badge && (
                  <span className={`
                    absolute -top-2.5 left-4 text-xs font-semibold px-2 py-0.5 rounded-full
                    ${isRec ? 'bg-indigo-500 text-white' : 'bg-gray-500 text-white'}
                  `}>
                    {pack.badge}
                  </span>
                )}

                <div>
                  <div className={`font-semibold text-sm ${isRec ? 'text-indigo-900' : 'text-gray-800'}`}>
                    {pack.label}
                  </div>
                  <div className={`text-xs mt-0.5 ${isRec ? 'text-indigo-600' : 'text-gray-500'}`}>
                    {pack.credits.toLocaleString()} credits
                  </div>
                </div>

                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className={`font-bold text-base ${isRec ? 'text-indigo-700' : 'text-gray-700'}`}>
                    ${pack.price}
                  </span>
                  {isLoading ? (
                    <svg className="w-4 h-4 animate-spin text-indigo-500" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                    </svg>
                  ) : (
                    <svg className={`w-4 h-4 ${isRec ? 'text-indigo-500' : 'text-gray-400'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7"/>
                    </svg>
                  )}
                </div>
              </button>
            )
          })}
        </div>

        {/* ── Error ───────────────────────────────────────────────────────── */}
        {error && (
          <div className="mx-6 mb-2 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">
            {error}
          </div>
        )}

        {/* ── Footer ──────────────────────────────────────────────────────── */}
        <div className="px-6 pb-6 pt-2 space-y-2">
          <button
            onClick={handleUpgradePlan}
            className="w-full rounded-xl border-2 border-gray-200 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 hover:border-gray-300 transition"
          >
            Upgrade plan instead →
          </button>

          <p className="text-center text-xs text-gray-400 pt-1">
            Credits never expire on paid plans • Secure checkout via Stripe
          </p>
        </div>

      </div>
    </div>
  )
}
