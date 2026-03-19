// app/api/billing/webhook/route.ts
// Receives and processes Stripe webhook events.
// Handles: checkout.session.completed, customer.subscription.updated/deleted,
//          invoice.payment_succeeded, invoice.payment_failed
// Thursday, March 19, 2026
import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function stripe() {
  if (!process.env.STRIPE_SECRET_KEY) throw new Error('STRIPE_SECRET_KEY not set')
  return new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' })
}

function db() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

const PRICE_TO_TIER: Record<string, string> = {
  [process.env.STRIPE_PRO_PRICE_ID     ?? 'unset']: 'pro',
  [process.env.STRIPE_CREATOR_PRICE_ID ?? 'unset']: 'power',
}

function getTier(sub: Stripe.Subscription): string {
  const priceId = sub.items.data[0]?.price?.id ?? ''
  return PRICE_TO_TIER[priceId] ?? 'pro'
}

async function upsertSubscription(
  supabase: ReturnType<typeof db>,
  userId: string,
  sub: Stripe.Subscription,
) {
  const tier   = getTier(sub)
  const status = sub.status === 'active' ? 'active'
               : sub.status === 'canceled' ? 'canceled'
               : sub.status === 'past_due' ? 'past_due'
               : 'active'

  await supabase.from('user_subscriptions').upsert({
    user_id:                  userId,
    provider:                 'stripe',
    provider_subscription_id: sub.id,
    plan_tier:                tier,
    status,
    current_period_end:       (sub.current_period_end ?? 0) * 1000,
    updated_at:               new Date().toISOString(),
  }, { onConflict: 'user_id,provider' })
}

export async function POST(req: NextRequest) {
  const supabase = db()
  const s        = stripe()

  const payload   = await req.text()
  const signature = req.headers.get('stripe-signature') ?? ''
  const secret    = process.env.STRIPE_WEBHOOK_SECRET ?? process.env.STRIPE_WEBHOOK_SECRET_NEW ?? ''

  let event: Stripe.Event
  try {
    event = s.webhooks.constructEvent(payload, signature, secret)
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[webhook] signature failed:', msg)
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  // Idempotency: skip already-processed events
  const { data: existing } = await supabase
    .from('billing_events')
    .select('id')
    .eq('stripe_event_id', event.id)
    .eq('processed', true)
    .maybeSingle()

  if (existing) {
    return NextResponse.json({ received: true, skipped: 'duplicate' })
  }

  // Log the raw event immediately
  await supabase.from('billing_events').upsert({
    stripe_event_id: event.id,
    event_type:      event.type,
    payload:         event.data as Record<string, unknown>,
    processed:       false,
  }, { onConflict: 'stripe_event_id' })

  try {
    switch (event.type) {

      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session
        const userId  = session.metadata?.userId
        if (!userId || !session.subscription) break
        const sub = await s.subscriptions.retrieve(session.subscription as string)
        await upsertSubscription(supabase, userId, sub)
        break
      }

      case 'customer.subscription.updated': {
        const sub    = event.data.object as Stripe.Subscription
        const userId = sub.metadata?.userId
        if (!userId) break
        await upsertSubscription(supabase, userId, sub)
        break
      }

      case 'customer.subscription.deleted': {
        const sub    = event.data.object as Stripe.Subscription
        const userId = sub.metadata?.userId
        if (!userId) break
        await supabase.from('user_subscriptions').update({
          status:    'canceled',
          plan_tier: 'free',
          updated_at: new Date().toISOString(),
        })
        .eq('user_id', userId)
        .eq('provider', 'stripe')
        break
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice
        const userId  = (invoice.subscription_details?.metadata?.userId
                      ?? (typeof invoice.customer === 'string' ? null : null)) as string | undefined
        if (!userId) break
        await supabase.from('user_subscriptions').update({
          status:     'past_due',
          updated_at: new Date().toISOString(),
        })
        .eq('user_id', userId)
        .eq('provider', 'stripe')
        break
      }
    }

    // Mark event processed
    await supabase.from('billing_events')
      .update({ processed: true })
      .eq('stripe_event_id', event.id)

    return NextResponse.json({ received: true, type: event.type })

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[webhook] handler error:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
