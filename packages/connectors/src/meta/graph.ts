import { ConnectorError, http, readJson, hmacHex, safeEqual } from '../shared/index.js';
import type { WebhookReq } from '../types.js';
import { createHmac, timingSafeEqual } from 'node:crypto';

export const GRAPH_VERSION = 'v26.0';
export const FB = `https://graph.facebook.com/${GRAPH_VERSION}`;
export const FB_VIDEO = `https://graph-video.facebook.com/${GRAPH_VERSION}`;
export const IG = `https://graph.instagram.com/${GRAPH_VERSION}`;
export const THREADS = 'https://graph.threads.net';

export interface GraphOpts { method?: 'GET' | 'POST' | 'DELETE'; token: string; params?: Record<string, any>; body?: Record<string, any>; form?: FormData }

export async function graph<T = any>(base: string, path: string, opts: GraphOpts): Promise<T> {
  const url = new URL(base + path);
  for (const [k, v] of Object.entries(opts.params ?? {})) if (v !== undefined && v !== null) url.searchParams.set(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
  if (opts.token) url.searchParams.set('access_token', opts.token);
  const res = await http(url, { method: opts.method ?? 'GET', body: opts.form ?? (opts.body ? JSON.stringify(opts.body) : undefined), headers: opts.form ? {} : opts.body ? { 'content-type': 'application/json' } : {} });
  const json: any = await readJson(res);
  if (!res.ok || json.error) throw metaError(json.error ?? { message: res.statusText, code: res.status }, res);
  return json as T;
}

/** Follow `paging.next` until exhausted (bounded). */
export async function graphAll(base: string, path: string, opts: GraphOpts, maxPages = 20): Promise<any[]> {
  const out: any[] = [];
  let page = await graph(base, path, opts);
  out.push(...(page.data ?? []));
  for (let i = 1; i < maxPages && page.paging?.next; i++) {
    const res = await http(page.paging.next); page = await readJson(res);
    if (page.error) throw metaError(page.error, res);
    out.push(...(page.data ?? []));
  }
  return out;
}

export function metaError(e: any, res?: Response): ConnectorError {
  const code = Number(e.code), sub = Number(e.error_subcode);
  const msg = e.error_user_msg ?? e.message ?? 'Meta API error';
  if (code === 190 || (code === 102 && sub === 467) || sub === 463 || sub === 460 || sub === 458) return new ConnectorError('AUTH', msg, { retryable: false, raw: e });
  if ([4, 17, 32, 613, 80001, 80002, 80004, 80005, 80006].includes(code)) return new ConnectorError('RATE_LIMIT', msg, { retryable: true, raw: e, retryAfterMs: 15 * 60_000 });
  if (code === 10 || (code >= 200 && code <= 299)) return new ConnectorError('AUTH', `Missing permission: ${msg}`, { retryable: false, raw: e });
  if (code === 100 && /Unsupported get request|missing permissions/i.test(msg)) return new ConnectorError('AUTH', 'Meta access verification (Tech Provider) missing or permission revoked', { retryable: false, raw: e });
  if ([1, 2].includes(code)) return new ConnectorError('PLATFORM', msg, { retryable: true, raw: e });
  if (code === 368 || code === 9007 || sub === 2207051) return new ConnectorError('POLICY', msg, { retryable: false, raw: e });
  if ([324, 352, 36000, 36001, 36003, 36004, 2207026, 2207020, 2207023, 2207027].includes(code) || [2207026, 2207020, 2207023, 2207027, 2207010].includes(sub)) return new ConnectorError('MEDIA', msg, { retryable: false, raw: e });
  if (res && res.status >= 500) return new ConnectorError('PLATFORM', msg, { retryable: true, raw: e });
  return new ConnectorError('VALIDATION', msg, { retryable: false, raw: e });
}

/** Meta webhook verification (GET challenge) and signature check (POST). Shared by page/instagram/threads/permissions objects. */
export function verifyMetaWebhook(req: WebhookReq, appSecret: string, verifyToken: string) {
  if (req.query['hub.mode'] === 'subscribe') return { ok: req.query['hub.verify_token'] === verifyToken, challengeResponse: req.query['hub.challenge'], contentType: 'text/plain' };
  const sig = req.headers['x-hub-signature-256'] ?? '';
  const expected = 'sha256=' + hmacHex(appSecret, req.rawBody);
  return { ok: safeEqual(sig, expected) };
}

/** Parse Meta signed_request (Data Deletion / Deauthorize callbacks). */
export function parseSignedRequest(signedRequest: string, appSecret: string): { algorithm: string; issued_at: number; user_id: string } {
  const [sig, payload] = signedRequest.split('.');
  const expected = createHmac('sha256', appSecret).update(payload).digest('base64url');
  const a = Buffer.from(sig), b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new Error('Bad signed_request signature');
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
}

/** Poll a Meta video/container until ready. */
export async function waitFor(check: () => Promise<'ok' | 'wait' | { error: string }>, opts: { timeoutMs?: number; initialMs?: number; maxMs?: number; label: string }) {
  const t0 = Date.now(); let delay = opts.initialMs ?? 5000;
  while (Date.now() - t0 < (opts.timeoutMs ?? 10 * 60_000)) {
    const r = await check();
    if (r === 'ok') return;
    if (typeof r === 'object') throw new ConnectorError('MEDIA', r.error, { retryable: false });
    await new Promise(res => setTimeout(res, delay)); delay = Math.min(delay * 1.5, opts.maxMs ?? 30_000);
  }
  throw new ConnectorError('PLATFORM', `${opts.label} processing timed out`, { retryable: true });
}
