// Claim Mars: the only way to create or edit a plot.
//
// POST { action: 'create', cell, title, description, url, logo, deviceId, turnstileToken }
// POST { action: 'update', cell, editToken, title, description, url, logo }
//   logo = { type: 'logodev' | 'monogram', src }  (src must be an img.logo.dev URL)
//        | { type: 'upload', dataUrl }            (PNG data URL, resized in the browser)
//
// Rules enforced here, whatever the browser says:
//  - valid plot at the site's H3 resolution, and free (famous plots need checkout)
//  - one free plot per device and at most FREE_PER_IP_PER_DAY per network per day
//  - Cloudflare Turnstile check when TURNSTILE_SECRET is set
//  - logos from a website link go live at once; uploaded images wait for approval
// Called with the publishable key, so deploy with verify_jwt = false.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { cellToLatLng, getResolution, isValidCell } from 'npm:h3-js@4';
import { featureAt } from '../_shared/features.js';
import { lightDelaySeconds } from '../_shared/orbits.js';

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

function secretKey(): string {
  const keys = Deno.env.get('SUPABASE_SECRET_KEYS');
  if (keys) {
    const parsed = JSON.parse(keys);
    return parsed.default ?? Object.values(parsed)[0];
  }
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
}

const db = createClient(Deno.env.get('SUPABASE_URL')!, secretKey(), { auth: { persistSession: false } });

async function sha256(text: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function randomToken(): string {
  return [...crypto.getRandomValues(new Uint8Array(24))].map((b) => b.toString(16).padStart(2, '0')).join('');
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

// What the browser gets back: the same shape as the claims_public view, as its owner sees it.
function publicRow(row: any) {
  const { edit_token_hash, ip_hash, device_id, ...rest } = row;
  return rest;
}

async function create(body: any, ip: string) {
  const cell = String(body.cell ?? '');
  if (!isValidCell(cell) || getResolution(cell) !== PLOT_RES) throw new HttpError(400, 'That is not a valid plot.');
  const [lat, lon] = cellToLatLng(cell);
  if (featureAt(lat, lon)) throw new HttpError(402, 'Famous plots can only be bought. Checkout is coming soon.');

  await verifyTurnstile(body.turnstileToken, ip);

  const ipHash = await sha256(`${ip}|${secretKey()}`);
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim() || req.headers.get('cf-connecting-ip') || 'unknown';
  try {
    const body = await req.json().catch(() => {
      throw new HttpError(400, 'Bad request.');
    });
    return json(body.action === 'update' ? await update(body) : await create(body, ip));
  } catch (err) {
    if (err instanceof HttpError) return json({ error: err.message }, err.status);
    console.error(err);
    return json({ error: 'Something went wrong. Please try again.' }, 500);
  }
});
