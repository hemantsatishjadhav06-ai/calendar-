import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '@relay/config';

// Stateless, unguessable, tamper-proof share tokens — no DB row needed. The token carries the post id
// and an expiry, signed with an HMAC over SESSION_SECRET (domain-separated with a "share:" prefix so it
// can never be confused with a session cookie). Revocation is by expiry; rotating SESSION_SECRET voids
// every outstanding link at once.
const b64url = (b: Buffer) => b.toString('base64url');
const sign = (data: string) => b64url(createHmac('sha256', env.SESSION_SECRET).update('share:' + data).digest());

export function makeShareToken(postId: string, ttlDays = 30): string {
  const payload = b64url(Buffer.from(JSON.stringify({ p: postId, e: Date.now() + ttlDays * 864e5 })));
  return `${payload}.${sign(payload)}`;
}

export function readShareToken(token: string): string | null {
  const [payload, sig] = (token ?? '').split('.');
  if (!payload || !sig) return null;
  const expected = sign(payload);
  const a = Buffer.from(sig), b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const { p, e } = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (!p || typeof e !== 'number' || Date.now() > e) return null;
    return p as string;
  } catch {
    return null;
  }
}
