import { describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import { metaError, verifyMetaWebhook, parseSignedRequest } from './graph.js';

describe('Meta error classification', () => {
  it('maps token errors to AUTH', () => { expect(metaError({ code: 190, message: 'Error validating access token' }).code).toBe('AUTH'); expect(metaError({ code: 190, error_subcode: 463 }).code).toBe('AUTH'); });
  it('maps throttling to RATE_LIMIT and retryable', () => { const e = metaError({ code: 4, message: 'Application request limit reached' }); expect(e.code).toBe('RATE_LIMIT'); expect(e.retryable).toBe(true); });
  it('maps missing permission to AUTH', () => { expect(metaError({ code: 200, message: 'Permissions error' }).code).toBe('AUTH'); });
  it('maps media problems to MEDIA and not retryable', () => { const e = metaError({ code: 352, message: 'Unsupported video' }); expect(e.code).toBe('MEDIA'); expect(e.retryable).toBe(false); });
});

describe('Meta webhooks', () => {
  const secret = 'shh';
  it('answers the subscription challenge', () => { const r = verifyMetaWebhook({ headers: {}, rawBody: Buffer.alloc(0), query: { 'hub.mode': 'subscribe', 'hub.verify_token': 'tok', 'hub.challenge': '42' } }, secret, 'tok'); expect(r.ok).toBe(true); expect(r.challengeResponse).toBe('42'); });
  it('verifies X-Hub-Signature-256', () => {
    const body = Buffer.from('{"object":"page"}'); const sig = 'sha256=' + createHmac('sha256', secret).update(body).digest('hex');
    expect(verifyMetaWebhook({ headers: { 'x-hub-signature-256': sig }, rawBody: body, query: {} }, secret, 'tok').ok).toBe(true);
    expect(verifyMetaWebhook({ headers: { 'x-hub-signature-256': 'sha256=bad' }, rawBody: body, query: {} }, secret, 'tok').ok).toBe(false);
  });
  it('parses a signed_request', () => {
    const payload = Buffer.from(JSON.stringify({ algorithm: 'HMAC-SHA256', issued_at: 1, user_id: 'u1' })).toString('base64url');
    const sig = createHmac('sha256', secret).update(payload).digest('base64url');
    expect(parseSignedRequest(`${sig}.${payload}`, secret).user_id).toBe('u1');
    expect(() => parseSignedRequest(`bad.${payload}`, secret)).toThrow();
  });
});
