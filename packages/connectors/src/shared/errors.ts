export type FailureCode = 'AUTH' | 'RATE_LIMIT' | 'MEDIA' | 'VALIDATION' | 'PLATFORM' | 'NETWORK' | 'POLICY' | 'UNKNOWN';

export class ConnectorError extends Error {
  retryable: boolean;
  retryAfterMs?: number;
  status?: number;
  raw?: unknown;
  constructor(public code: FailureCode, message: string, opts: { retryable?: boolean; retryAfterMs?: number; status?: number; raw?: unknown } = {}) {
    super(message);
    this.name = 'ConnectorError';
    this.retryable = opts.retryable ?? (code === 'PLATFORM' || code === 'NETWORK' || code === 'RATE_LIMIT');
    this.retryAfterMs = opts.retryAfterMs;
    this.status = opts.status;
    this.raw = opts.raw;
  }
}

/** Map any thrown value to a ConnectorError. */
const FAILURE_CODES: readonly FailureCode[] = ['AUTH', 'RATE_LIMIT', 'MEDIA', 'VALIDATION', 'PLATFORM', 'NETWORK', 'POLICY', 'UNKNOWN'];

export function classifyError(err: unknown): ConnectorError {
  if (err instanceof ConnectorError) return err;
  const e = err as any;
  // Recognise a ConnectorError that lost its prototype identity — `instanceof` fails across
  // separately-compiled copies of this class (the worker/api tsc builds each emit their own),
  // and connectors may throw a structurally-compatible error. Match on the tagged name + code.
  if (e?.name === 'ConnectorError' && typeof e.code === 'string' && (FAILURE_CODES as readonly string[]).includes(e.code)) {
    return new ConnectorError(e.code as FailureCode, String(e.message ?? e), {
      retryable: e.retryable,
      retryAfterMs: e.retryAfterMs,
      status: e.status,
      raw: e.raw,
    });
  }
  const msg = String(e?.message ?? e);
  if (e?.code && ['ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT', 'UND_ERR_SOCKET'].includes(e.code)) {
    return new ConnectorError('NETWORK', msg, { retryable: true });
  }
  if (/timed out|timeout/i.test(msg)) return new ConnectorError('NETWORK', msg, { retryable: true });
  return new ConnectorError('UNKNOWN', msg, { retryable: false, raw: err });
}

export const msUntilUtcMidnight = () => { const d = new Date(); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1) - d.getTime(); };
export const msUntilPacificMidnight = () => {
  const now = new Date();
  const pt = new Date(now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }));
  const next = new Date(pt); next.setHours(24, 0, 0, 0);
  return next.getTime() - pt.getTime();
};
