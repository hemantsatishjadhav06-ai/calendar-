import { Worker, type Job } from 'bullmq';
import { prismaAdmin, type Channel } from '@cadence/db';
import { getConnector, classifyError, type InboxItem, type WebhookEvent } from '@cadence/connectors';
import { tokenVault } from '@cadence/token-vault';
import { connection, queue, log, emit } from './infra.js';
import { triageComment } from '@cadence/ai';

/** Poll intervals per network (ms). Networks with webhooks poll rarely as a safety net. */
const POLL_MS: Record<string, number> = { BLUESKY: 2 * 60_000, MASTODON: 3 * 60_000, YOUTUBE: 10 * 60_000, X: 15 * 60_000, GOOGLE_BUSINESS: 30 * 60_000, FACEBOOK: 60 * 60_000, INSTAGRAM: 60 * 60_000, THREADS: 60 * 60_000, LINKEDIN: 30 * 60_000, TIKTOK: 6 * 3600_000, PINTEREST: 0, START_PAGE: 0 };

export function inboxWorker() {
  return new Worker('inbox', async (job: Job) => {
    switch (job.name) {
      case 'schedule-polls': return schedulePolls();
      case 'poll': return poll(job.data.channelId);
      case 'webhook': return processWebhook(job.data.inboxId, job.data.network);
      default: return 'unknown';
    }
  }, { connection, concurrency: Number(process.env.INBOX_CONCURRENCY ?? 8) });
}

async function schedulePolls() {
  const channels = await prismaAdmin.channel.findMany({ where: { status: 'ACTIVE', deletedAt: null }, include: { organization: { select: { settings: true } } } });
  let n = 0;
  for (const ch of channels) {
    const every = POLL_MS[ch.network]; if (!every) continue;
    if ((ch.organization.settings as any)?.communityDisabled) continue;   // org-level kill switch (Settings → Organization)
    const bucket = Math.floor(Date.now() / every);
    await queue('inbox').add('poll', { channelId: ch.id, organizationId: ch.organizationId }, { jobId: `poll-${ch.id}-${bucket}` }); n++;
  }
  return `polls:${n}`;
}

async function poll(channelId: string) {
  const ch = await prismaAdmin.channel.findUnique({ where: { id: channelId } });
  if (!ch || ch.status !== 'ACTIVE') return 'skip';
  const connector = getConnector(ch.network);
  if (!connector.pollInbox) return 'unsupported';
  try {
    const creds = await tokenVault.forChannel(ch.id, ch, connector.refresh.bind(connector));
    const { items, cursor } = await connector.pollInbox(creds, ch, ch.inboxCursor ?? undefined);
    const n = await ingest(ch, items);
    if (cursor) await prismaAdmin.channel.update({ where: { id: ch.id }, data: { inboxCursor: cursor } });
    return `ingested:${n}`;
  } catch (e) {
    const c = classifyError(e);
    if (c.code === 'AUTH') await prismaAdmin.channel.update({ where: { id: ch.id }, data: { status: 'RECONNECT_REQUIRED', statusReason: c.message.slice(0, 250) } });
    log.warn({ channelId, code: c.code, msg: c.message }, 'inbox poll failed');
    return `failed:${c.code}`;
  }
}

async function processWebhook(inboxId: string, network: string) {
  const row = await prismaAdmin.webhookInbox.findUnique({ where: { id: BigInt(inboxId) } });
  if (!row || row.processedAt) return 'skip';
  const connector = getConnector(network as any);
  try {
    const events: WebhookEvent[] = connector.parseWebhook?.(row.payload) ?? [];
    for (const ev of events) {
      const channels = await prismaAdmin.channel.findMany({ where: { network: network as any, externalId: ev.externalChannelId, deletedAt: null } });
      // Some payloads identify the channel indirectly (IG fb_login variant → page id; LinkedIn → org urn); fall back to meta match
      const matched = channels.length ? channels : await prismaAdmin.channel.findMany({ where: { deletedAt: null, network: network as any, OR: [{ meta: { path: ['pageId'], equals: ev.externalChannelId } }, { meta: { path: ['locationName'], equals: ev.externalChannelId } }] } });
      for (const ch of matched) {
        if (ev.kind === 'inbox' && ev.items?.length) await ingest(ch, await enrich(ch, ev.items));
        else if (ev.kind === 'permissions') { await prismaAdmin.channel.update({ where: { id: ch.id }, data: { status: 'RECONNECT_REQUIRED', statusReason: 'Permissions changed or app removed' } }); await emit(ch.organizationId, { type: 'channel.updated', channelId: ch.id }); }
        else if (ev.kind === 'publish' && ev.raw?.publishId) await finalizeTikTok(ch, ev.raw);
        else if (ev.kind === 'story_insights') await queue('metrics').add('story-insights', { channelId: ch.id, value: ev.raw?.value ?? ev.raw }, { jobId: `story-${ch.id}-${ev.raw?.value?.media_id ?? Date.now()}` });
        else if (ev.kind === 'media' && ev.raw?.videoId) await queue('metrics').add('backfill', { channelId: ch.id, organizationId: ch.organizationId }, { jobId: `yt-media-${ch.id}-${ev.raw.videoId}` });
        else if (ev.kind === 'inbox') await queue('inbox').add('poll', { channelId: ch.id, organizationId: ch.organizationId }, { jobId: `poll-wh-${ch.id}-${Math.floor(Date.now() / 60_000)}` });   // e.g. GBP review notification → re-fetch
      }
    }
    await prismaAdmin.webhookInbox.update({ where: { id: row.id }, data: { processedAt: new Date() } });
    return `events:${events.length}`;
  } catch (e: any) {
    await prismaAdmin.webhookInbox.update({ where: { id: row.id }, data: { error: e.message?.slice(0, 300) } });
    throw e;
  }
}

/** Fill in text/author for webhook payloads that only carry ids (IG mentions, LinkedIn notifications). */
async function enrich(ch: Channel, items: InboxItem[]): Promise<InboxItem[]> {
  const needs = items.filter(i => i.raw?.needsEnrichment);
  if (!needs.length) return items;
  const connector = getConnector(ch.network);
  if (!connector.pollInbox) return items.filter(i => !i.raw?.needsEnrichment);
  const creds = await tokenVault.forChannel(ch.id, ch, connector.refresh.bind(connector));
  const { items: fresh } = await connector.pollInbox(creds, ch, undefined);
  const byId = new Map(fresh.map(f => [f.externalId, f]));
  return items.map(i => (i.raw?.needsEnrichment ? byId.get(i.externalId) ?? null : i)).filter(Boolean) as InboxItem[];
}

async function finalizeTikTok(ch: Channel, raw: { event: string; publishId: string; postId?: string; reason?: string }) {
  const t = await prismaAdmin.postTarget.findFirst({ where: { channelId: ch.id, OR: [{ externalPostId: raw.publishId }, { metadata: { path: ['publishExtra', 'publishId'], equals: raw.publishId } }] } });
  if (!t) return;
  if (raw.event === 'post.publish.publicly_available' && raw.postId) await prismaAdmin.postTarget.update({ where: { id: t.id }, data: { externalPostId: raw.postId, externalUrl: `https://www.tiktok.com/@${ch.handle ?? '_'}/video/${raw.postId}` } });
  if (raw.event === 'post.publish.failed') { await prismaAdmin.postTarget.update({ where: { id: t.id }, data: { status: 'FAILED', failureCode: 'PLATFORM', failureMessage: `TikTok: ${raw.reason ?? 'publish failed'}` } }); await emit(ch.organizationId, { type: 'target.failed', targetId: t.id, code: 'PLATFORM', message: raw.reason }); }
}

/** Normalise → upsert → link to post → mark replies from us → triage → emit. */
export async function ingest(ch: Channel, items: InboxItem[]) {
  let n = 0;
  for (const it of items) {
    if (!it.externalId) continue;
    const target = it.externalPostId ? await prismaAdmin.postTarget.findFirst({ where: { channelId: ch.id, externalPostId: it.externalPostId }, select: { id: true, text: true } }) : null;
    const existing = await prismaAdmin.comment.findUnique({ where: { channelId_externalId: { channelId: ch.id, externalId: it.externalId } } });
    if (existing) {
      await prismaAdmin.comment.update({ where: { id: existing.id }, data: { likeCount: it.likeCount ?? existing.likeCount, isHidden: it.isHidden ?? existing.isHidden, text: it.text || existing.text, ...(it.repliedAt && !existing.repliedAt ? { repliedAt: it.repliedAt } : {}) } });
      continue;
    }
    const created = await prismaAdmin.comment.create({ data: {
      organizationId: ch.organizationId, channelId: ch.id, postTargetId: target?.id ?? null, externalPostId: it.externalPostId ?? null, externalId: it.externalId, parentExternalId: it.parentExternalId ?? null,
      kind: it.kind, authorExternalId: it.author.id ?? null, authorName: it.author.name ?? null, authorHandle: it.author.handle ?? null, authorAvatarUrl: it.author.avatarUrl ?? null,
      text: it.text ?? '', attachments: (it.attachments ?? []) as any, externalCreatedAt: it.createdAt, likeCount: it.likeCount ?? 0, isHidden: !!it.isHidden, isOurs: !!it.isOurs, repliedAt: it.repliedAt ?? null, raw: sanitize(it.raw),
    } });
    n++;
    if (it.isOurs && it.parentExternalId) {
      await prismaAdmin.comment.updateMany({ where: { channelId: ch.id, externalId: it.parentExternalId, repliedAt: null }, data: { repliedAt: it.createdAt } });
      continue;
    }
    // AI triage (labels, sentiment, needs_review) — best effort, never blocks ingestion
    triageComment({ text: created.text, postText: target?.text, network: ch.network }).then(async tr => {
      await prismaAdmin.comment.update({ where: { id: created.id }, data: { labels: tr.labels, sentiment: tr.sentiment, triage: tr.triage } });
    }).catch(() => undefined);
    await emit(ch.organizationId, { type: 'comment.new', commentId: created.id, channelId: ch.id });
  }
  return n;
}
const sanitize = (raw: any) => { try { return JSON.parse(JSON.stringify(raw ?? {}, (_k, v) => (typeof v === 'string' && v.length > 5000 ? v.slice(0, 5000) : v))); } catch { return {}; } };
