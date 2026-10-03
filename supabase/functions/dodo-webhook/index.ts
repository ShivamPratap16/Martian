// Dodo Payments webhook: turns a paid order into a claim on the map.
//
// Dodo signs every delivery with the Standard Webhooks scheme (webhook-id,
// webhook-timestamp and webhook-signature headers, HMAC-SHA256 with DODO_WEBHOOK_SECRET).
// Unsigned or tampered requests are rejected. Deliveries can repeat, so every step is
// idempotent. Called by Dodo, not a signed-in user, so deploy with verify_jwt = false.
//
// Events handled:
//   payment.succeeded              -> create the claim (free = false), order 'paid'
//   payment.failed / .cancelled    -> order 'failed', which frees the plot again
// If the plot was taken while the buyer was paying, the order becomes 'conflict' and the
// payment should be refunded from the Dodo dashboard.

import { Webhook } from 'npm:standardwebhooks@1';
import { db } from '../_shared/db.ts';
import { lightDelaySeconds } from '../_shared/orbits.js';

const ok = () => new Response('ok');

async function orderFor(payment: any) {
  const id = String(payment?.metadata?.order_id ?? '');
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const { data } = await db.from('orders').select('*').eq('id', id).maybeSingle();
  // Only the checkout session we created for this order may pay for it.
  if (!data || (data.checkout_session_id && payment.checkout_session_id && data.checkout_session_id !== payment.checkout_session_id)) {
    console.error('Payment does not match an order', payment?.payment_id, id);
    return null;
  }
  return data;
}

async function fulfil(payment: any) {
  const order = await orderFor(payment);
  if (!order || order.status === 'paid' || order.status === 'conflict') return;
  const productId = Deno.env.get('DODO_PRODUCT_ID');
  if (productId && payment.product_cart && !payment.product_cart.some((p: any) => p.product_id === productId)) {
    console.error('Payment is not for the plot product', payment.payment_id);
    return;
  }

  const { error } = await db.from('claims').insert({
    cell: order.cell,
    title: order.title,
    description: order.description,
    url: order.url,
    domain: order.domain,
    logo_type: order.logo_type,
    logo_url: order.logo_url,
    status: order.logo_status,
    free: false,
    lands_at: new Date(Date.now() + lightDelaySeconds() * 1000).toISOString(),
    edit_token_hash: order.edit_token_hash,
    ip_hash: order.ip_hash,
    device_id: order.device_id,
  });

  let status = 'paid';
  if (error?.code === '23505') {
    // Already there: ours from an earlier delivery, or someone else's.
    const { data: existing } = await db.from('claims').select('edit_token_hash').eq('cell', order.cell).single();
    if (existing?.edit_token_hash !== order.edit_token_hash) status = 'conflict';
  } else if (error) {
    throw error; // a 500 makes Dodo retry the delivery later
  }
  await db
    .from('orders')
    .update({ status, payment_id: payment.payment_id, paid_at: new Date().toISOString() })
    .eq('id', order.id);
  if (status === 'conflict') console.error(`Order ${order.id} paid for a plot that was already taken: refund ${payment.payment_id}`);
}

async function release(payment: any) {
  const order = await orderFor(payment);
  if (order?.status === 'pending') await db.from('orders').update({ status: 'failed' }).eq('id', order.id);
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  const secret = Deno.env.get('DODO_WEBHOOK_SECRET');
  if (!secret) return new Response('Webhook secret not configured', { status: 500 });

  const raw = await req.text();
  let event: any;
  try {
    event = new Webhook(secret).verify(raw, {
      'webhook-id': req.headers.get('webhook-id') ?? '',
      'webhook-timestamp': req.headers.get('webhook-timestamp') ?? '',
      'webhook-signature': req.headers.get('webhook-signature') ?? '',
    });
  } catch {
    return new Response('Invalid signature', { status: 401 });
  }

  try {
    if (event.type === 'payment.succeeded') await fulfil(event.data);
    else if (event.type === 'payment.failed' || event.type === 'payment.cancelled') await release(event.data);
    return ok();
  } catch (err) {
    console.error(err);
    return new Response('Error', { status: 500 });
  }
});
