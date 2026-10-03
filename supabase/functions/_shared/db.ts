// Server-side helpers shared by the edge functions: the secret-key database client and
// hashing. The secret key bypasses row-level security, so it never leaves the server.

import { createClient } from 'npm:@supabase/supabase-js@2';

export function secretKey(): string {
  const keys = Deno.env.get('SUPABASE_SECRET_KEYS');
  if (keys) {
    const parsed = JSON.parse(keys);
    return parsed.default ?? Object.values(parsed)[0];
  }
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
}

export const db = createClient(Deno.env.get('SUPABASE_URL')!, secretKey(), { auth: { persistSession: false } });

export async function sha256(text: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function randomToken(): string {
  return [...crypto.getRandomValues(new Uint8Array(24))].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// What the browser gets back for a claim: the same shape as the claims_public view, as its
// owner sees it.
export function publicRow(row: any) {
  const { edit_token_hash, ip_hash, device_id, ...rest } = row;
  return rest;
}
