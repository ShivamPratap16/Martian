// Claim storage. With Supabase configured (VITE_SUPABASE_URL + VITE_SUPABASE_PUBLISHABLE_KEY)
// the map reads the public claims view and every write goes through the `claim` edge
// function. Without it, claims live in this browser's localStorage so the site still
// works for local development.
//
// Claim shape used across the app:
//   { cell, status, free, createdAt, landsAt, title, description, url, domain, logo }
// logo is { type, src } or null while an uploaded logo waits for review.

const SB_URL = import.meta.env.VITE_SUPABASE_URL;
const SB_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
export const backendEnabled = !!(SB_URL && SB_KEY);

const LOCAL_CLAIMS_KEY = 'claimMars.claims.v1';
const MY_FREE_KEY = 'claimMars.myFreeClaim.v1';
const MINE_KEY = 'claimMars.mine.v1'; // { cell: { claim, editToken } } for plots this browser owns
const DEVICE_KEY = 'claimMars.device.v1';

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function deviceId() {
  let id = read(DEVICE_KEY, null);
  if (!id) {
    id = crypto.randomUUID();
    write(DEVICE_KEY, id);
  }
  return id;
}

function fromRow(r) {
  return {
    cell: r.cell,
    status: r.status,
    free: r.free,
    createdAt: r.created_at,
    landsAt: r.lands_at,
    title: r.title ?? null,
    description: r.description ?? '',
    url: r.url ?? '',
    domain: r.domain ?? '',
    logo: r.logo_url ? { type: r.logo_type, src: r.logo_url } : null,
  };
}

async function callFunction(body) {
  let res;
  try {
    res = await fetch(`${SB_URL}/functions/v1/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: SB_KEY },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error('Could not reach the server. Check your connection and try again.');
  }
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(out.error || 'Something went wrong. Please try again.');
  return out;
}

function remember(claim, editToken) {
  const mine = read(MINE_KEY, {});
  mine[claim.cell] = { claim, editToken: editToken ?? mine[claim.cell]?.editToken };
  write(MINE_KEY, mine);
}

// The logo payload the server expects.
function logoPayload(logo) {
  if (!logo) return null;
  return logo.type === 'upload' ? { type: 'upload', dataUrl: logo.src } : { type: logo.type, src: logo.src };
}

export async function loadClaims() {
  if (!backendEnabled) return new Map(read(LOCAL_CLAIMS_KEY, []).map((c) => [c.cell, c]));
  const claims = new Map();
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const res = await fetch(`${SB_URL}/rest/v1/claims_public?select=*&order=created_at.asc`, {
      headers: { apikey: SB_KEY, Range: `${from}-${from + PAGE - 1}`, 'Range-Unit': 'items' },
    });
    if (!res.ok) throw new Error('Could not load the map.');
    const rows = await res.json();
    for (const r of rows) claims.set(r.cell, fromRow(r));
    if (rows.length < PAGE) break;
  }
  // Owners see their own plot in full even while its logo is being reviewed.
  for (const { claim } of Object.values(read(MINE_KEY, {}))) {
    const server = claims.get(claim.cell);
    if (server && !server.logo) claims.set(claim.cell, { ...server, ...claim, status: server.status });
  }
  return claims;
}

export async function saveClaim(claims, draft, { turnstileToken } = {}) {
  if (claims.has(draft.cell)) throw new Error('This plot was just claimed by someone else.');
  if (myFreeClaim()) throw new Error('You already claimed your free plot.');
  let claim;
  let editToken = null;
  if (backendEnabled) {
    const out = await callFunction({
      action: 'create',
      cell: draft.cell,
      title: draft.title,
      description: draft.description,
      url: draft.url,
      logo: logoPayload(draft.logo),
      deviceId: deviceId(),
      turnstileToken,
    });
    // Keep the owner's own copy of the logo (uploads show before approval).
    claim = { ...fromRow(out.claim), logo: draft.logo };
    editToken = out.editToken;
  } else {
    claim = { ...draft, status: 'approved' };
    const local = read(LOCAL_CLAIMS_KEY, []);
    local.push(claim);
    if (!write(LOCAL_CLAIMS_KEY, local)) throw new Error('Could not save your claim (browser storage is full or blocked).');
  }
  claims.set(claim.cell, claim);
  write(MY_FREE_KEY, claim.cell);
  remember(claim, editToken);
  return claim;
}

export async function updateClaim(claims, cell, draft) {
  const token = editTokenFor(cell);
  if (!token) throw new Error('This browser does not have the edit link for this plot.');
  const logoChanged = draft.logo && draft.logo.src !== claims.get(cell)?.logo?.src;
  const out = await callFunction({
    action: 'update',
    cell,
    editToken: token,
    title: draft.title,
    description: draft.description,
    url: draft.url,
    logo: logoChanged ? logoPayload(draft.logo) : null,
  });
  const claim = { ...fromRow(out.claim), logo: draft.logo ?? claims.get(cell)?.logo };
  claims.set(cell, claim);
  remember(claim, token);
  return claim;
}

export function myFreeClaim() {
  return read(MY_FREE_KEY, null);
}

export function editTokenFor(cell) {
  return read(MINE_KEY, {})[cell]?.editToken ?? null;
}

export function editLinkFor(cell) {
  const token = editTokenFor(cell);
  return token ? `${location.origin}/?edit=${encodeURIComponent(`${cell}.${token}`)}` : null;
}

// Opening an edit link on another device: remember the token, then clean the URL.
// Returns the plot's cell, or null.
export function importEditLink() {
  const params = new URLSearchParams(location.search);
  const raw = params.get('edit');
  if (!raw) return null;
  const [cell, token] = raw.split('.');
  params.delete('edit');
  history.replaceState(null, '', `${location.pathname}${params.size ? `?${params}` : ''}${location.hash}`);
  if (!cell || !token) return null;
  const mine = read(MINE_KEY, {});
  mine[cell] = { claim: mine[cell]?.claim ?? { cell }, editToken: token };
  write(MINE_KEY, mine);
  write(MY_FREE_KEY, cell);
  return cell;
}

// ---------- paid plots (Dodo Payments) ----------
// Buying saves the claim as an order on the server and returns a Dodo checkout link. After
// paying, Dodo sends the buyer back with ?order=<id>; the order's edit token stays in this
// browser so it can check the order and edit the plot afterwards.

const ORDERS_KEY = 'claimMars.orders.v1'; // { orderId: { cell, editToken } }

export async function startCheckout(draft, { turnstileToken } = {}) {
  if (!backendEnabled) throw new Error('Checkout needs the server, which is not set up here.');
  const out = await callFunction({
    action: 'checkout',
    cell: draft.cell,
    title: draft.title,
    description: draft.description,
    url: draft.url,
    logo: logoPayload(draft.logo),
    deviceId: deviceId(),
    turnstileToken,
  });
  const orders = read(ORDERS_KEY, {});
  orders[out.orderId] = { cell: draft.cell, editToken: out.editToken };
  if (!write(ORDERS_KEY, orders)) throw new Error('Could not save your order (browser storage is full or blocked).');
  return out.checkoutUrl;
}

// Back from checkout: the order id from the URL (then cleaned), or null.
export function takeReturnedOrder() {
  const params = new URLSearchParams(location.search);
  const id = params.get('order');
  if (!id) return null;
  for (const key of ['order', 'payment_id', 'status']) params.delete(key); // Dodo adds the last two
  history.replaceState(null, '', `${location.pathname}${params.size ? `?${params}` : ''}${location.hash}`);
  return read(ORDERS_KEY, {})[id] ? id : null;
}

export function pendingOrders() {
  return Object.keys(read(ORDERS_KEY, {}));
}

// Asks the server how the order is doing. Returns { status, cell, claim? } where status is
// 'pending' | 'paid' | 'conflict' | 'failed'. Once settled, the order is forgotten; a paid
// one becomes this browser's plot.
export async function checkOrder(claims, orderId) {
  const orders = read(ORDERS_KEY, {});
  const order = orders[orderId];
  if (!order) return { status: 'failed' };
  let out;
  try {
    out = await callFunction({ action: 'order', orderId, editToken: order.editToken });
  } catch (err) {
    if (/not found/i.test(err.message)) out = { status: 'failed', cell: order.cell };
    else throw err;
  }
  if (out.status === 'paid' && out.claim) {
    const claim = fromRow(out.claim);
    claims.set(claim.cell, claim);
    remember(claim, order.editToken);
  }
  if (out.status !== 'pending') {
    delete orders[orderId];
    write(ORDERS_KEY, orders);
  }
  return { ...out, claim: claims.get(out.cell) ?? null };
}
