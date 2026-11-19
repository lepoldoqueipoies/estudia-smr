const encoder = new TextEncoder();

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}
function fromBase64Url(value: string): Uint8Array {
  const padded = value.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - value.length % 4) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, c => c.charCodeAt(0));
}
async function hmac(payload: string): Promise<Uint8Array> {
  const secret = Deno.env.get('SESSION_SECRET');
  if (!secret || secret.length < 32) throw new Error('Configura SESSION_SECRET (mínimo 32 caracteres) en Supabase Edge Function Secrets.');
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(payload)));
}
function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}
export async function signSession(user: string): Promise<string> {
  const payload = toBase64Url(encoder.encode(JSON.stringify({ user, exp: Date.now() + 86_400_000 })));
  return `${payload}.${toBase64Url(await hmac(payload))}`;
}
export async function verifySession(token: string | null | undefined): Promise<string | null> {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  try {
    const [payload, signature] = parts;
    if (!payload || !/^[A-Za-z0-9_-]{43}$/.test(signature)) return null;
    const expected = await hmac(payload);
    if (!constantTimeEqual(expected, fromBase64Url(signature))) return null;
    const data = JSON.parse(new TextDecoder().decode(fromBase64Url(payload)));
    return typeof data.user === 'string' && data.exp > Date.now() ? data.user : null;
  } catch {
    return null;
  }
}
export function constantTimeTextEqual(a: string, b: string): boolean {
  const aa = encoder.encode(a), bb = encoder.encode(b);
  if (aa.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < aa.length; i++) diff |= aa[i] ^ bb[i];
  return diff === 0;
}
