// api/webhook/stripe.js — Stripe Webhook Handler
// Handles: payment_intent.succeeded, checkout.session.completed, customer.subscription.*

import { createHmac, timingSafeEqual } from 'crypto';

export const config = { api: { bodyParser: false } }; // raw body required for sig verification

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const sig = req.headers['stripe-signature'];
  const secret = process.env.STRIPE_WEBHOOK_SECRET;

  // Read raw body
  const buf = await readRawBody(req);

  // Verify Stripe signature (prevents spoofed webhooks)
  let event;
  try {
    event = verifyStripeSignature(buf, sig, secret);
  } catch (e) {
    console.error('Webhook signature failed:', e.message);
    return res.status(400).json({ error: `Webhook signature verification failed: ${e.message}` });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed':
        await handleCheckoutComplete(event.data.object);
        break;
      case 'payment_intent.succeeded':
        await handlePaymentSuccess(event.data.object);
        break;
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
        await handleSubscriptionUpdate(event.data.object);
        break;
      case 'customer.subscription.deleted':
        await handleSubscriptionCanceled(event.data.object);
        break;
      default:
        console.log(`Unhandled event type: ${event.type}`);
    }
    return res.json({ received: true });
  } catch (e) {
    console.error('Webhook handler error:', e);
    return res.status(500).json({ error: e.message });
  }
}

async function handleCheckoutComplete(session) {
  const { customer_email, amount_total, metadata, customer } = session;
  const product_slug = metadata?.slug || metadata?.product || 'unknown';

  // Write to Supabase
  await supabaseInsert('sales', {
    stripe_session_id: session.id,
    customer_email,
    customer_id: customer,
    amount_cents: amount_total,
    product_slug,
    event_type: 'checkout_completed',
    created_at: new Date().toISOString(),
  });

  // Send welcome email via Resend
  if (customer_email && product_slug !== 'unknown') {
    const productUrl = `https://${product_slug}.vercel.app`;

    await fetch(`${process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000'}/api/email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'welcome',
        to: customer_email,
        productName: product_slug,
        productUrl,
        freeLimit: null, // paid user — unlimited
      }),
    }).catch(() => { });

    // Start post-payment nurture sequence
    await fetch(`${process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000'}/api/email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'post_payment_sequence',
        to: customer_email,
        productName: product_slug,
        productUrl,
      }),
    }).catch(() => { });
  }

  console.log(`✅ Payment: ${customer_email} → ${product_slug} ($${amount_total / 100})`);
}

async function handlePaymentSuccess(intent) {
  await supabaseInsert('payments', {
    stripe_intent_id: intent.id,
    amount_cents: intent.amount,
    currency: intent.currency,
    customer_id: intent.customer,
    status: 'succeeded',
    created_at: new Date().toISOString(),
  });
}

async function handleSubscriptionUpdate(subscription) {
  await supabaseUpsert('subscriptions', {
    stripe_sub_id: subscription.id,
    customer_id: subscription.customer,
    status: subscription.status,
    plan_amount_cents: subscription.items?.data?.[0]?.price?.unit_amount || 0,
    current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  }, 'stripe_sub_id');
}

async function handleSubscriptionCanceled(subscription) {
  await supabaseUpdate('subscriptions', { status: 'canceled', canceled_at: new Date().toISOString() }, 'stripe_sub_id', subscription.id);
}

// ─── Supabase helpers ─────────────────────────────────────────────────────────
async function supabaseInsert(table, data) {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
  if (!SUPABASE_URL || !SUPABASE_KEY) return;
  await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', 'Content-Profile': 'public', Prefer: 'return=minimal' },
    body: JSON.stringify(data),
  });
}

async function supabaseUpsert(table, data, conflictCol) {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
  if (!SUPABASE_URL || !SUPABASE_KEY) return;
  await fetch(`${SUPABASE_URL}/rest/v1/${table}?on_conflict=${conflictCol}`, {
    method: 'POST',
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', 'Content-Profile': 'public', Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(data),
  });
}

async function supabaseUpdate(table, data, col, val) {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
  if (!SUPABASE_URL || !SUPABASE_KEY) return;
  await fetch(`${SUPABASE_URL}/rest/v1/${table}?${col}=eq.${val}`, {
    method: 'PATCH',
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', 'Content-Profile': 'public', Prefer: 'return=minimal' },
    body: JSON.stringify(data),
  });
}

// ─── Minimal Stripe signature verification (no Stripe SDK needed) ─────────────
function verifyStripeSignature(payload, signature, secret) {
  const parts = signature.split(',').reduce((acc, part) => {
    const [k, v] = part.split('=');
    acc[k] = v;
    return acc;
  }, {});

  const timestamp = parts.t;
  const receivedSig = parts.v1;
  if (!timestamp || !receivedSig) throw new Error('Missing timestamp or signature');

  const age = Math.abs(Date.now() / 1000 - parseInt(timestamp));
  if (age > 300) throw new Error('Webhook too old (> 5 minutes)');

  const signedPayload = `${timestamp}.${payload}`;
  const expectedSig = createHmac('sha256', secret).update(signedPayload).digest('hex');

  if (!timingSafeEqual(Buffer.from(receivedSig), Buffer.from(expectedSig))) {
    throw new Error('Signature mismatch');
  }

  return JSON.parse(payload.toString());
}

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
