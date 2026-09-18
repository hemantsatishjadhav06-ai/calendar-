import { All, Controller, Param, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { createHash } from 'node:crypto';
import { prismaAdmin, type Network } from '@cadence/db';
import { getConnector, parseSignedRequest } from '@cadence/connectors';
import { env } from '@cadence/config';
import { QueuesService } from '../infra/queues.service.js';

/**
 * Inbound webhooks. Fast path: verify signature → store in WebhookInbox (idempotent) → 200 → enqueue processing.
 * Meta/TikTok/LinkedIn disable subscriptions after repeated failures, so nothing slow happens here.
 */
@Controller('webhooks')
export class WebhooksController {
  constructor(private queues: QueuesService) {}

  @All(':provider')
  async receive(@Param('provider') provider: string, @Req() req: Request, @Res() res: Response) {
    const rawBody: Buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from(typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? {}));
    const headers = Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k.toLowerCase(), Array.isArray(v) ? v[0] : String(v ?? '')]));
    const query = req.query as Record<string, string>;

    // Meta data-deletion / deauthorize callbacks
    if (provider === 'meta-deletion' || provider === 'meta-deauthorize') {
      const params = new URLSearchParams(rawBody.toString('utf8'));
      try {
        const sr = parseSignedRequest(params.get('signed_request') ?? '', env.META_APP_SECRET ?? '');
        await this.queues.get('housekeeping').add('meta-user-deletion', { userId: sr.user_id, kind: provider });
        const code = createHash('sha256').update(`${sr.user_id}:${Date.now()}`).digest('hex').slice(0, 16);
        return res.json({ url: `${env.APP_URL}/deletion-status/${code}`, confirmation_code: code });
      } catch { return res.status(400).send('bad signature'); }
    }

    const network = PROVIDER_TO_NETWORK[provider];
    if (!network) return res.status(404).send('unknown provider');
    const connector = getConnector(network);
    if (!connector.verifyWebhook) return res.status(404).send('no webhooks');

    const v = connector.verifyWebhook({ headers, rawBody, query });
    if (v.challengeResponse !== undefined) { res.type(v.contentType ?? 'text/plain'); return res.send(v.challengeResponse); }   // subscription handshakes (Meta hub.challenge, X CRC, LinkedIn challengeCode, YouTube hub)
    if (!v.ok) return res.status(401).send('invalid signature');

    let body: any;
    if (provider === 'youtube') body = parseAtom(rawBody.toString('utf8'));
    else { try { body = JSON.parse(rawBody.toString('utf8')); } catch { body = {}; } }

    const eventId = headers['x-request-id'] ?? headers['x-li-notification-id'] ?? body?.notificationId ?? body?.event_id ?? createHash('sha256').update(rawBody).digest('hex');
    const row = await prismaAdmin.webhookInbox.upsert({ where: { provider_eventId: { provider, eventId } }, create: { provider, eventId, payload: body, signatureOk: true }, update: {} });
    res.status(200).send('ok');
    if (!row.processedAt) await this.queues.get('inbox').add('webhook', { inboxId: String(row.id), provider, network }, { jobId: `wh-${row.id}` }).catch(() => undefined);
  }
}

export const PROVIDER_TO_NETWORK: Record<string, Network> = { meta: 'FACEBOOK', facebook: 'FACEBOOK', instagram: 'INSTAGRAM', threads: 'THREADS', x: 'X', linkedin: 'LINKEDIN', tiktok: 'TIKTOK', youtube: 'YOUTUBE', gbp: 'GOOGLE_BUSINESS' };

/** Minimal Atom parser for YouTube PubSubHubbub notifications. */
export function parseAtom(xml: string) {
  const get = (tag: string) => xml.match(new RegExp(`<${tag}[^>]*>([^<]*)<\\/${tag}>`))?.[1];
  return { videoId: get('yt:videoId'), channelId: get('yt:channelId'), title: get('title'), published: get('published'), updated: get('updated'), deleted: /<at:deleted-entry/.test(xml) };
}
