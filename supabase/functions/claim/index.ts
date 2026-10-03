// Claim Mars: the only way to create or edit a plot.
//
// POST { action: 'create', cell, title, description, url, logo, deviceId, turnstileToken }
// POST { action: 'update', cell, editToken, title, description, url, logo }
// POST { action: 'checkout', cell, title, description, url, logo, deviceId, turnstileToken }
//   famous plots: saves the claim as an order and returns a Dodo Payments checkout URL.
//   The dodo-webhook function turns the order into a claim once the payment succeeds.
// POST { action: 'order', orderId, editToken }  -> { status, claim? } for the buyer
//   logo = { type: 'logodev' | 'monogram', src }  (src must be an img.logo.dev URL)
//        | { type: 'upload', dataUrl }            (PNG data URL, resized in the browser)
//
// Rules enforced here, whatever the browser says:
//  - valid plot at the site's H3 resolution, and free (famous plots go through checkout)
//  - one free plot per device and at most FREE_PER_IP_PER_DAY per network per day
//  - Cloudflare Turnstile check when TURNSTILE_SECRET is set
//  - logos from a website link go live at once; uploaded images wait for approval
// Called with the publishable key, so deploy with verify_jwt = false.

import { cellToLatLng, getResolution, isValidCell } from 'npm:h3-js@4';
import { featureAt, PREMIUM_PRICE } from '../_shared/features.js';
import { lightDelaySeconds } from '../_shared/orbits.js';
import { db, publicRow, randomToken, secretKey, sha256 } from '../_shared/db.ts';

const PLOT_RES = 3;
const FREE_PER_IP_PER_DAY = 3;
const MAX_UPLOAD_BYTES = 400 * 1024;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

function cleanText(value: unknown, max: number): string {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
}

function cleanLink(value: unknown): { url: string; domain: string } | null {
  const s = String(value ?? '').trim();
  if (!s) return null;
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(s) ? s : `https://${s}`);
    if ((u.protocol !== 'https:' && u.protocol !== 'http:') || !u.hostname.includes('.')) throw new Error();
    return { url: u.href, domain: u.hostname.replace(/^www\./, '') };
  } catch {
    throw new HttpError(400, 'Check your website link.');
  }
}

async function verifyTurnstile(token: unknown, ip: string) {
  const secret = Deno.env.get('TURNSTILE_SECRET');
  if (!secret) return; // not configured yet
  const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    body: new URLSearchParams({ secret, response: String(token ?? ''), remoteip: ip }),
  });
  const out = await res.json();
  if (!out.success) throw new HttpError(403, 'Bot check failed. Please try again.');
}

// Returns the logo fields to store, uploading images to Storage.
async function resolveLogo(logo: any, cell: string, domain: string) {
  if (logo?.type === 'upload') {
    const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(String(logo.dataUrl ?? ''));
    if (!m) throw new HttpError(400, 'Logo must be a PNG image.');
    const bytes = Uint8Array.from(atob(m[1]), (c) => c.charCodeAt(0));
    if (bytes.length > MAX_UPLOAD_BYTES) throw new HttpError(400, 'Logo image is too large.');
    const path = `${cell}-${randomToken().slice(0, 12)}.png`;
    const { error } = await db.storage.from('logos').upload(path, bytes, { contentType: 'image/png', upsert: false });
    if (error) throw new HttpError(500, 'Could not store the logo.');
    return { logo_type: 'upload', logo_url: db.storage.from('logos').getPublicUrl(path).data.publicUrl, status: 'pending' };
  }
  if (logo?.type === 'logodev' || logo?.type === 'monogram') {
    const src = String(logo.src ?? '');
    const u = new URL(src);
    if (u.origin !== 'https://img.logo.dev' || !domain || decodeURIComponent(u.pathname.slice(1)) !== domain) {
      throw new HttpError(400, 'Logo does not match the website link.');
    }
    return { logo_type: logo.type, logo_url: src, status: 'approved' };
  }
  throw new HttpError(400, 'Add your website link or upload a logo.');
}

function validCell(value: unknown): string {
  const cell = String(value ?? '');
  if (!isValidCell(cell) || getResolution(cell) !== PLOT_RES) throw new HttpError(400, 'That is not a valid plot.');
  return cell;
}

const ipHashOf = (ip: string) => sha256(`${ip}|${secretKey()}`);

async function create(body: any, ip: string) {
  const cell = validCell(body.cell);
  const [lat, lon] = cellToLatLng(cell);
  if (featureAt(lat, lon)) throw new HttpError(402, 'Famous plots can only be bought.');

  await verifyTurnstile(body.turnstileToken, ip);

  const ipHash = await ipHashOf(ip);
  const deviceId = cleanText(body.deviceId, 64);
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { count: recent } = await db
    .from('claims')
    .select('cell', { count: 'exact', head: true })
    .eq('ip_hash', ipHash)
    .eq('free', true)
    .gte('created_at', since);
  if ((recent ?? 0) >= FREE_PER_IP_PER_DAY) throw new HttpError(429, 'Too many free claims from your network today. Try again tomorrow.');
  if (deviceId) {
    const { count: onDevice } = await db.from('claims').select('cell', { count: 'exact', head: true }).eq('device_id', deviceId).eq('free', true);
    if ((onDevice ?? 0) > 0) throw new HttpError(409, 'You already claimed your free plot.');
  }

  const link = cleanLink(body.url);
  const title = cleanText(body.title, 40) || link?.domain || '';
  if (!title) throw new HttpError(400, 'Add a name for your plot.');
  const logo = await resolveLogo(body.logo, cell, link?.domain ?? '');
  const editToken = randomToken();

  const { data, error } = await db
    .from('claims')
    .insert({
      cell,
      title,
      description: cleanText(body.description, 100),
      url: link?.url ?? '',
      domain: link?.domain ?? '',
      ...logo,
      free: true,
      lands_at: new Date(Date.now() + lightDelaySeconds() * 1000).toISOString(),
      edit_token_hash: await sha256(editToken),
      ip_hash: ipHash,
      device_id: deviceId,
    })
    .select()
    .single();
  if (error?.code === '23505') throw new HttpError(409, 'Someone just claimed this plot. Pick another one.');
  if (error) throw new HttpError(500, 'Could not save your claim.');
  return { claim: publicRow(data), editToken };
}

async function update(body: any) {
  const cell = String(body.cell ?? '');
  const { data: existing } = await db.from('claims').select('*').eq('cell', cell).maybeSingle();
  if (!existing || existing.edit_token_hash !== (await sha256(String(body.editToken ?? '')))) {
    throw new HttpError(403, 'This edit link is not valid.');
  }
  const link = cleanLink(body.url);
  const title = cleanText(body.title, 40) || link?.domain || existing.title;
  const changes: Record<string, unknown> = {
    title,
    description: cleanText(body.description, 100),
    url: link?.url ?? '',
    domain: link?.domain ?? '',
  };
  if (body.logo) Object.assign(changes, await resolveLogo(body.logo, cell, link?.domain ?? ''));
  const { data, error } = await db.from('claims').update(changes).eq('cell', cell).select().single();
  if (error) throw new HttpError(500, 'Could not save your changes.');
  return { claim: publicRow(data) };
}

// ---------- paid plots (Dodo Payments) ----------

const DODO_API = Deno.env.get('DODO_ENVIRONMENT') === 'live_mode' ? 'https://live.dodopayments.com' : 'https://test.dodopayments.com';

async function createCheckoutSession(order: { id: string; cell: string; amount: number }, site: string) {
  const res = await fetch(`${DODO_API}/checkouts`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${Deno.env.get('DODO_API_KEY')}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      // A one-time product priced at PREMIUM_PRICE. `amount` only applies if the product is
      // set to pay-what-you-want, and then pins the price.
      product_cart: [{ product_id: Deno.env.get('DODO_PRODUCT_ID'), quantity: 1, amount: order.amount }],
      metadata: { order_id: order.id, cell: order.cell },
      return_url: `${site}/?order=${order.id}`,
      cancel_url: `${site}/`,
    }),
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok || !out.checkout_url) {
    console.error('Dodo checkout failed', res.status, out);
    throw new HttpError(502, 'Could not start the checkout. Please try again.');
  }
  return out as { session_id: string; checkout_url: string };
}

// Where Dodo sends the buyer back to: SITE_URL if set, else the page that asked.
function siteUrl(req: Request): string {
  const site = Deno.env.get('SITE_URL') || req.headers.get('origin') || '';
  if (!/^https?:\/\/[^/]+/.test(site)) throw new HttpError(400, 'Bad request.');
  return site.replace(/\/+$/, '');
}

async function checkout(body: any, ip: string, req: Request) {
  if (!Deno.env.get('DODO_API_KEY') || !Deno.env.get('DODO_PRODUCT_ID')) throw new HttpError(503, 'Checkout is not open yet.');
  const site = siteUrl(req);
  const cell = validCell(body.cell);
  const [lat, lon] = cellToLatLng(cell);
  if (!featureAt(lat, lon)) throw new HttpError(400, 'This plot is free. Claim it instead.');

  await verifyTurnstile(body.turnstileToken, ip);

  const { data: taken } = await db.from('claims').select('cell').eq('cell', cell).maybeSingle();
  if (taken) throw new HttpError(409, 'Someone just claimed this plot. Pick another one.');

  // A pending checkout holds the plot for a while. The same browser may start over.
  const deviceId = cleanText(body.deviceId, 64);
  const now = new Date().toISOString();
  const { data: held } = await db.from('orders').select('id, device_id').eq('cell', cell).eq('status', 'pending').gt('expires_at', now);
  if (held?.some((o) => !deviceId || o.device_id !== deviceId)) {
    throw new HttpError(409, 'Someone is checking out this plot right now. Try again in a few minutes.');
  }
  if (held?.length) await db.from('orders').update({ status: 'failed' }).in('id', held.map((o) => o.id));

  const link = cleanLink(body.url);
  const title = cleanText(body.title, 40) || link?.domain || '';
  if (!title) throw new HttpError(400, 'Add a name for your plot.');
  const logo = await resolveLogo(body.logo, cell, link?.domain ?? '');
  const editToken = randomToken();

  const { data: order, error } = await db
    .from('orders')
    .insert({
      cell,
      title,
      description: cleanText(body.description, 100),
      url: link?.url ?? '',
      domain: link?.domain ?? '',
      logo_type: logo.logo_type,
      logo_url: logo.logo_url,
      logo_status: logo.status,
      amount: PREMIUM_PRICE * 100,
      edit_token_hash: await sha256(editToken),
      ip_hash: await ipHashOf(ip),
      device_id: deviceId,
    })
    .select()
    .single();
  if (error) throw new HttpError(500, 'Could not start the checkout.');

  const session = await createCheckoutSession(order, site).catch(async (err) => {
    await db.from('orders').update({ status: 'failed' }).eq('id', order.id); // free the plot again
    throw err;
  });
  await db.from('orders').update({ checkout_session_id: session.session_id }).eq('id', order.id);
  return { orderId: order.id, editToken, checkoutUrl: session.checkout_url };
}

// The buyer checks on their order after paying (the webhook may arrive a moment later).
async function orderStatus(body: any) {
  const id = String(body.orderId ?? '');
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new HttpError(400, 'Bad request.');
  const { data: order } = await db.from('orders').select('*').eq('id', id).maybeSingle();
  if (!order || order.edit_token_hash !== (await sha256(String(body.editToken ?? '')))) {
    throw new HttpError(404, 'Order not found.');
  }
  // Dodo checkout links expire after 24 hours, so an older pending order was abandoned.
  const abandoned = order.status === 'pending' && Date.now() - Date.parse(order.created_at) > 25 * 3600 * 1000;
  if (order.status !== 'paid') return { status: abandoned ? 'failed' : order.status, cell: order.cell };
  const { data: claim } = await db.from('claims').select('*').eq('cell', order.cell).maybeSingle();
  return { status: order.status, cell: order.cell, claim: claim ? publicRow(claim) : null };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim() || req.headers.get('cf-connecting-ip') || 'unknown';
  try {
    const body = await req.json().catch(() => {
      throw new HttpError(400, 'Bad request.');
    });
    switch (body.action) {
      case 'update':
        return json(await update(body));
      case 'checkout':
        return json(await checkout(body, ip, req));
      case 'order':
        return json(await orderStatus(body));
      default:
        return json(await create(body, ip));
    }
  } catch (err) {
    if (err instanceof HttpError) return json({ error: err.message }, err.status);
    console.error(err);
    return json({ error: 'Something went wrong. Please try again.' }, 500);
  }
});
