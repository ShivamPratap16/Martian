// Claim storage. For now claims live in this browser's localStorage so the flow can be
// tested end to end; the async API is shaped so it can be swapped for Supabase later.

const CLAIMS_KEY = 'claimMars.claims.v1';
const MY_FREE_KEY = 'claimMars.myFreeClaim.v1';

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

export async function loadClaims() {
  return new Map(read(CLAIMS_KEY, []).map((c) => [c.cell, c]));
}

// claim: { cell, title, description, url, domain, logo, free, createdAt }
export async function saveClaim(claims, claim) {
  if (claims.has(claim.cell)) throw new Error('This plot was just claimed by someone else.');
  if (claim.free && myFreeClaim()) throw new Error('You already claimed your free plot.');
  claims.set(claim.cell, claim);
  if (!write(CLAIMS_KEY, [...claims.values()])) {
    claims.delete(claim.cell);
    throw new Error('Could not save your claim (browser storage is full or blocked).');
  }
  if (claim.free) write(MY_FREE_KEY, claim.cell);
  return claim;
}

export function myFreeClaim() {
  return read(MY_FREE_KEY, null);
}
