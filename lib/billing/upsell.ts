// lib/billing/upsell.ts
// Credit pack config and upsell payload computation.
// Single source of truth — imported by routes and the UpsellModal component.
// Updated: March 21, 2026 — Initial implementation.
//
// PACK SELECTION LOGIC:
//   balance > 20% of tier credits  → no upsell
//   0 < balance ≤ 20% of tier      → low_credits  → recommend mid pack (525)
//   balance = 0 OR blocked by 402  → out_of_credits → recommend top pack (1300)

// ── Credit pack definitions ───────────────────────────────────────────────────
// priceIds are live Stripe one-time payment prices from lib/pricing/config.ts.
// mode: "payment" for all packs — these are NOT subscriptions.
export const CREDIT_PACKS = {
  "50": {
    label:    "Starter Pack",
    credits:  50,
    price:    4.99,
    priceId:  "price_1SdaLR7YeQ1dZTUvX4qPsy3c",
    badge:    null,
  },
  "150": {
    label:    "Creator Pack",
    credits:  150,
    price:    12.99,
    priceId:  "price_1SdaLa7YeQ1dZTUvsjFZWqjB",
    badge:    "Most Popular",
  },
  "525": {
    label:    "Pro Pack",
    credits:  525,
    price:    39.99,
    priceId:  "price_1SdaLk7YeQ1dZTUvdcDKtnTI",
    badge:    "Best Value",
  },
  "1300": {
    label:    "Studio Pack",
    credits:  1300,
    price:    89.99,
    priceId:  "price_1SdaLt7YeQ1dZTUvGhjqaNyk",
    badge:    "Power User",
  },
} as const

export type PackKey = keyof typeof CREDIT_PACKS
export type UpsellType = "low_credits" | "out_of_credits"

export interface UpsellPayload {
  show:             true
  type:             UpsellType
  balance:          number
  tier_credits:     number
  recommended_pack: PackKey
  packs:            PackKey[]   // ordered options to show
  message:          string
}

export interface NoUpsell {
  show: false
}

export type UpsellResult = UpsellPayload | NoUpsell

// Tier credit allocation — mirrors TIER_CREDITS in lib/pricing/config.ts (craudiovizai).
// Kept here to avoid a cross-repo import. Must stay in sync manually.
export const TIER_MONTHLY_CREDITS: Record<string, number> = {
  free:    25,
  starter: 150,
  pro:     600,
  premium: 2500,
  // Aliases used by some legacy code
  professional: 600,
  business:     2500,
}

const LOW_CREDIT_THRESHOLD = 0.20  // 20% of tier allocation

/**
 * computeUpsell — determine whether to show an upsell, and which pack to recommend.
 *
 * @param balance      - user's current credit balance (from enforcePrecheck result)
 * @param tier         - user's subscription tier (from entitlement gate)
 * @param isBlocked    - true when the request was blocked by a 402 (no_credits)
 * @returns UpsellResult — { show: false } or full UpsellPayload
 */
export function computeUpsell(
  balance: number,
  tier: string,
  isBlocked = false,
): UpsellResult {
  const tierCredits = TIER_MONTHLY_CREDITS[tier] ?? TIER_MONTHLY_CREDITS.free
  const threshold   = Math.ceil(tierCredits * LOW_CREDIT_THRESHOLD)

  // No upsell if balance is healthy and not blocked
  if (!isBlocked && balance > threshold) {
    return { show: false }
  }

  // Determine upsell type
  const type: UpsellType = (isBlocked || balance <= 0) ? "out_of_credits" : "low_credits"

  // Pack recommendation:
  //   out_of_credits → recommend 1300 (maximum value, immediate unblock)
  //   low_credits    → recommend  525 (meaningful top-up, best value)
  const recommended: PackKey = type === "out_of_credits" ? "1300" : "525"

  // Show 3 packs: the one below recommended, recommended, and the one above (or wrap)
  const packKeys = Object.keys(CREDIT_PACKS) as PackKey[]
  const recIdx   = packKeys.indexOf(recommended)
  const startIdx = Math.max(0, recIdx - 1)
  const packs    = packKeys.slice(startIdx, startIdx + 3) as PackKey[]

  const message = type === "out_of_credits"
    ? "You're out of credits. Top up to continue."
    : `Running low — ${balance} credit${balance !== 1 ? "s" : ""} remaining.`

  return {
    show:             true,
    type,
    balance,
    tier_credits:     tierCredits,
    recommended_pack: recommended,
    packs,
    message,
  }
}
