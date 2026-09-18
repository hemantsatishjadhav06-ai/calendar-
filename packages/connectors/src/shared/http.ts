import { fetch as undiciFetch, Agent } from 'undici';
import pino from 'pino';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { ConnectorError, classifyError } from './errors.js';

export const log = pino({ name: 'connectors', level: process.env.LOG_LEVEL ?? 'info', redact: ['*.access_token', '*.refresh_token', 'headers.authorization', 'headers.Authorization'] });

const agent = new Agent({ connect: { timeout: 15_000 }, headersTimeout: 60_000, bodyTimeout: 10 * 60_000 });

export interface HttpInit extends Omit<RequestInit, 'body'> { body?: any; timeoutMs?: number; duplex?: 'half' }

/** fetch with sane timeouts, network error classification and a span-friendly log line. */
export async function http(url: string | URL, init: HttpInit = {}): Promise<Response> {
  const started = Date.now();
  const u = url.toString();
  try {
    const res = (await undiciFetch(u, { ...(init as any), dispatcher: agent, signal: init.timeoutMs ? AbortSignal.timeout(init.timeoutMs) : init.signal })) as unknown as Response;
    log.debug({ method: init.method ?? 'GET', url: redact(u), status: res.status, ms: Date.now() - started }, 'http');
    return res;
  } catch (e) {
    log.warn({ method: init.method ?? 'GET', url: redact(u), err: String((e as any)?.message), ms: Date.now() - started }, 'http error');
    throw classifyError(e);
  }
}

const redact = (u: string) => u.replace(/(access_token|client_secret|token)=[^&]+/gi, '$1=***');

export async function readJson<T = any>(res: Response): Promise<T> {
  const text = await res.text();
  try { return text ? (JSON.parse(text) as T) : ({} as T); } catch { return { _raw: text } as any; }
}

export function retryAfterMs(res: Response, fallback = 60_000) {
  const h = res.headers.get('retry-after');
  if (!h) return fallback;
  const n = Number(h);
  if (!Number.isNaN(n)) return n * 1000;
  const d = Date.parse(h);
  return Number.isNaN(d) ? fallback : Math.max(0, d - Date.now());
}

export const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export function pkce() {
  const verifier = randomBytes(48).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

export const newState = () => randomBytes(16).toString('hex');

export const hmacHex = (secret: string, data: string | Buffer) => createHmac('sha256', secret).update(data).digest('hex');
export const hmacB64 = (secret: string, data: string | Buffer) => createHmac('sha256', secret).update(data).digest('base64');
export const safeEqual = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export function assertConfigured(...pairs: [string, string | undefined][]) {
  const missing = pairs.filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) throw new ConnectorError('POLICY', `Connector not configured: set ${missing.join(', ')}`, { retryable: false });
}
