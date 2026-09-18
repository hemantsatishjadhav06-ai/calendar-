import { env } from '@relay/config';
import { ConnectorError, http, readJson, pkce, newState, assertConfigured, msUntilPacificMidnight } from '../shared/index.js';

export function googleAuthUrl(redirectUri: string, scopes: string[]) {
  assertConfigured(['GOOGLE_CLIENT_ID', env.GOOGLE_CLIENT_ID]);
  const state = newState(); const { verifier, challenge } = pkce();
  const url = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID!, redirect_uri: redirectUri, response_type: 'code', scope: scopes.join(' '), access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true', state, code_challenge: challenge, code_challenge_method: 'S256' });
  return { url, state, codeVerifier: verifier };
}

export async function googleToken(form: Record<string, string>) {
  const r = await http('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ ...form, client_id: env.GOOGLE_CLIENT_ID!, client_secret: env.GOOGLE_CLIENT_SECRET! }) });
  const j: any = await readJson(r);
  if (!r.ok) throw new ConnectorError('AUTH', j.error_description ?? j.error ?? 'Google token error', { retryable: false, raw: j });
  return j;
}

export async function gget(url: string, tok: string, params: Record<string, string> = {}) {
  const u = new URL(url); for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  const r = await http(u, { headers: { Authorization: `Bearer ${tok}` } });
  if (!r.ok) throw await gErr(r);
  return readJson(r);
}
export async function gpost(url: string, tok: string, body: any, method: 'POST' | 'PUT' | 'PATCH' = 'POST') {
  const r = await http(url, { method, headers: { Authorization: `Bearer ${tok}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) throw await gErr(r);
  return readJson(r);
}
export async function gdel(url: string, tok: string) { const r = await http(url, { method: 'DELETE', headers: { Authorization: `Bearer ${tok}` } }); if (!r.ok && r.status !== 404) throw await gErr(r); }

export async function gErr(r: Response) {
  const j: any = await readJson(r);
  const reason = j.error?.errors?.[0]?.reason ?? j.error?.status;
  const msg = j.error?.message ?? r.statusText;
  if (r.status === 401) return new ConnectorError('AUTH', 'Google token invalid or revoked', { retryable: false, raw: j });
  if (reason === 'quotaExceeded' || reason === 'dailyLimitExceeded' || reason === 'RESOURCE_EXHAUSTED') return new ConnectorError('RATE_LIMIT', `Google quota exceeded (${reason})`, { retryable: true, retryAfterMs: msUntilPacificMidnight(), raw: j });
  if (reason === 'rateLimitExceeded' || reason === 'userRateLimitExceeded') return new ConnectorError('RATE_LIMIT', 'Google rate limit', { retryable: true, retryAfterMs: 60_000, raw: j });
  if (reason === 'uploadLimitExceeded') return new ConnectorError('POLICY', 'YouTube channel daily upload limit reached', { retryable: true, retryAfterMs: msUntilPacificMidnight(), raw: j });
  if (r.status === 403) return new ConnectorError('POLICY', msg, { retryable: false, raw: j });
  return new ConnectorError(r.status >= 500 ? 'PLATFORM' : 'VALIDATION', msg, { retryable: r.status >= 500, raw: j });
}
