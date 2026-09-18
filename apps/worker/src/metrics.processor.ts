import { Worker, type Job } from 'bullmq';
import { DateTime } from 'luxon';
import { Prisma, prismaAdmin } from '@cadence/db';
import { getConnector, classifyError } from '@cadence/connectors';
import { tokenVault } from '@cadence/token-vault';
import { connection, queue, log } from './infra.js';

/**
 * metrics queue jobs:
 *  schedule-daily          hourly → enqueue `channel-daily` for channels whose local hour is 2 (spread), once per day
 *  channel-daily           collect channel metrics (since last cursor − 3 days) + weekly audience
 *  bootstrap               first pull for a freshly published post, then re-enqueue at 2h, 6h, 24h, 48h, 72h
 *  refresh-recent-posts    every 6h → post metrics for posts < 30d (daily), < 90d (weekly), < 365d (monthly)
 *  discover-native-posts   daily → import posts published outside Cadence so Insights is complete
 *  backfill                after connect → 90 days of channel metrics + last 50 posts
 */
export function metricsWorker() {
  return new Worker('metrics', async (job: Job) => {
    switch (job.name) {
      case 'schedule-daily': return scheduleDaily();
      case 'channel-daily': return channelDaily(job.data.channelId);
      case 'bootstrap': return bootstrap(job.data.targetId);
      case 'refresh-recent-posts': return refreshRecent();
      case 'discover-native-posts': return discoverAll();
      case 'backfill': return backfill(job.data.channelId);
      case 'story-insights': return storyInsights(job.data);
      default: return 'unknown';
    }
  }, { connection, concurrency: Number(process.env.METRICS_CONCURRENCY ?? 6), lockDuration: 10 * 60_000 });
}

async function activeChannels(where: Prisma.ChannelWhereInput = {}) {
  return prismaAdmin.channel.findMany({ where: { status: 'ACTIVE', deletedAt: null, network: { not: 'START_PAGE' }, ...where } });
}
async function credsFor(ch: any) { const connector = getConnector(ch.network); return { connector, creds: await tokenVault.forChannel(ch.id, ch, connector.refresh.bind(connector)) }; }
const day = (d: Date) => d.toISOString().slice(0, 10);

async function scheduleDaily() {
  const channels = await activeChannels();
  let n = 0;
  for (const ch of channels) {
    const local = DateTime.now().setZone(ch.timezone);
    const spreadHour = 2 + (parseInt(ch.id.slice(-2), 16) % 3);      // 02:00–04:00 local, spread by id
    if (local.hour !== spreadHour) continue;
    const today = local.toISODate()!;
    if (ch.metricsCursor && day(ch.metricsCursor) === today) continue;
    await queue('metrics').add('channel-daily', { channelId: ch.id, organizationId: ch.organizationId }, { jobId: `daily-${ch.id}-${today}` }); n++;
  }
  return `scheduled:${n}`;
}

async function channelDaily(channelId: string) {
  const ch = await prismaAdmin.channel.findUnique({ where: { id: channelId } });
  if (!ch || ch.status !== 'ACTIVE') return 'skip';
  const { connector, creds } = await credsFor(ch);
  const until = new Date(); until.setUTCHours(0, 0, 0, 0);                     // yesterday inclusive
  const since = new Date((ch.metricsCursor ?? new Date(Date.now() - 30 * 864e5)).getTime() - 3 * 864e5);
  try {
    if (connector.collectChannelMetrics) {
      const rows = await connector.collectChannelMetrics({ channel: ch, creds, since, until });
      await upsertChannelMetrics(ch.id, rows);
    }
    if (connector.collectAudience && DateTime.now().weekday === 1) {
      const rows = await connector.collectAudience({ channel: ch, creds, since, until });
      if (rows.length) { const d = new Date(day(until)); await prismaAdmin.audienceSnapshot.deleteMany({ where: { channelId: ch.id, day: d } }); await prismaAdmin.audienceSnapshot.createMany({ data: rows.map(r => ({ channelId: ch.id, day: d, dimension: r.dimension, bucket: r.bucket, value: r.value })), skipDuplicates: true }); }
    }
    await prismaAdmin.channel.update({ where: { id: ch.id }, data: { metricsCursor: new Date() } });
    return 'ok';
  } catch (e) {
    const c = classifyError(e);
    if (c.code === 'AUTH') await prismaAdmin.channel.update({ where: { id: ch.id }, data: { status: 'RECONNECT_REQUIRED', statusReason: c.message.slice(0, 250) } });
    log.warn({ channelId, code: c.code, msg: c.message }, 'channel metrics failed');
    if (c.retryable) throw e;
    return `failed:${c.code}`;
  }
}

export async function upsertChannelMetrics(channelId: string, rows: { day: string; metric: string; value: number }[]) {
  for (const r of rows) {
    if (!r.metric || !Number.isFinite(r.value)) continue;
    await prismaAdmin.$executeRaw`INSERT INTO "ChannelMetricDaily" ("channelId", day, metric, value, source) VALUES (${channelId}::uuid, ${r.day}::date, ${r.metric}, ${r.value}, 'api') ON CONFLICT ("channelId", day, metric) DO UPDATE SET value = EXCLUDED.value`;
  }
}
async function insertPostMetrics(targetIdByExternal: Map<string, string>, rows: { externalPostId: string; metric: string; value: number }[]) {
  const at = new Date();
  const data = rows.map(r => ({ postTargetId: targetIdByExternal.get(r.externalPostId), capturedAt: at, metric: r.metric, value: r.value })).filter(r => r.postTargetId && Number.isFinite(r.value)) as any[];
  if (data.length) await prismaAdmin.postMetric.createMany({ data, skipDuplicates: true });
}

const BOOTSTRAP_DELAYS_MS = [2 * 3600_000, 4 * 3600_000, 18 * 3600_000, 24 * 3600_000, 24 * 3600_000];
async function bootstrap(targetId: string) {
  const t = await prismaAdmin.postTarget.findUnique({ where: { id: targetId }, include: { channel: true } });
  if (!t?.externalPostId || t.status !== 'PUBLISHED') return 'skip';
  await collectForTargets(t.channel, [t]);
  const step = Number((t.metadata as any)?.bootstrapStep ?? 0);
  if (step < BOOTSTRAP_DELAYS_MS.length) {
    await prismaAdmin.postTarget.update({ where: { id: t.id }, data: { metadata: { ...(t.metadata as any), bootstrapStep: step + 1 } } });
    await queue('metrics').add('bootstrap', { targetId: t.id, organizationId: t.organizationId }, { delay: BOOTSTRAP_DELAYS_MS[step], jobId: `bootstrap-${t.id}-${step + 1}` });
  }
  return 'ok';
}

async function collectForTargets(ch: any, targets: { id: string; externalPostId: string | null }[]) {
  const { connector, creds } = await credsFor(ch);
  if (!connector.collectPostMetrics) return;
  const map = new Map(targets.filter(t => t.externalPostId).map(t => [t.externalPostId!, t.id]));
  const rows = await connector.collectPostMetrics({ channel: ch, creds, since: new Date(0), until: new Date(), externalPostIds: [...map.keys()] });
  await insertPostMetrics(map, rows);
}

async function refreshRecent() {
  const channels = await activeChannels();
  const now = Date.now(); let n = 0;
  for (const ch of channels) {
    const targets = await prismaAdmin.postTarget.findMany({ where: { channelId: ch.id, status: 'PUBLISHED', externalPostId: { not: null }, publishedAt: { gte: new Date(now - 365 * 864e5) } }, select: { id: true, externalPostId: true, publishedAt: true, metadata: true } });
    const due = targets.filter(t => {
      const age = now - t.publishedAt!.getTime(); const last = Number((t.metadata as any)?.metricsAt ?? 0);
      const interval = age < 30 * 864e5 ? 864e5 : age < 90 * 864e5 ? 7 * 864e5 : 30 * 864e5;
      return now - last >= interval;
    });
    if (!due.length) continue;
    try {
      for (let i = 0; i < due.length; i += 50) await collectForTargets(ch, due.slice(i, i + 50));
      await prismaAdmin.$executeRaw`UPDATE "PostTarget" SET metadata = metadata || jsonb_build_object('metricsAt', ${now}) WHERE id = ANY(${due.map(d => d.id)}::uuid[])`;
      n += due.length;
    } catch (e) { log.warn({ channelId: ch.id, err: (e as any).message }, 'post metrics refresh failed'); }
  }
  return `refreshed:${n}`;
}

/** Import posts published natively (or via Notify-me) so Insights covers everything. */
async function discoverAll() {
  const channels = await activeChannels(); let n = 0;
  for (const ch of channels) n += await discover(ch).catch(e => { log.warn({ channelId: ch.id, err: e.message }, 'discover failed'); return 0; });
  return `discovered:${n}`;
}
async function discover(ch: any) {
  const { connector, creds } = await credsFor(ch);
  if (!connector.listRecentPosts) return 0;
  const since = new Date(Date.now() - 7 * 864e5);
  const recent = await connector.listRecentPosts(creds, ch, since);
  const known = new Set((await prismaAdmin.postTarget.findMany({ where: { channelId: ch.id, externalPostId: { in: recent.map(r => r.externalId) } }, select: { externalPostId: true } })).map(x => x.externalPostId));
  let created = 0;
  for (const r of recent.filter(r => !known.has(r.externalId))) {
    // Match a NOTIFIED/PUBLISHED-without-id Cadence target by time window + text similarity, else create a "discovered" post
    const candidate = await prismaAdmin.postTarget.findFirst({ where: { channelId: ch.id, externalPostId: null, status: { in: ['NOTIFIED', 'PUBLISHED'] }, dueAt: { gte: new Date(r.createdAt.getTime() - 6 * 3600_000), lte: new Date(r.createdAt.getTime() + 6 * 3600_000) } } });
    if (candidate && similar(candidate.text, r.text ?? '')) { await prismaAdmin.postTarget.update({ where: { id: candidate.id }, data: { status: 'PUBLISHED', publishedAt: r.createdAt, externalPostId: r.externalId, externalUrl: r.url } }); continue; }
    const post = await prismaAdmin.post.create({ data: { organizationId: ch.organizationId, createdByAccountId: ch.connectedByAccountId, status: 'PUBLISHED', scheduleMode: 'NOW', baseText: r.text ?? '', baseMedia: [] } });
    await prismaAdmin.postTarget.create({ data: { organizationId: ch.organizationId, postId: post.id, channelId: ch.id, status: 'PUBLISHED', publishedAt: r.createdAt, externalPostId: r.externalId, externalUrl: r.url, text: r.text ?? '', metadata: { discovered: true, mediaUrl: r.mediaUrl } } });
    created++;
  }
  return created;
}
const similar = (a: string, b: string) => { const na = a.toLowerCase().replace(/\s+/g, ' ').slice(0, 80), nb = b.toLowerCase().replace(/\s+/g, ' ').slice(0, 80); return na && nb ? (na.startsWith(nb.slice(0, 40)) || nb.startsWith(na.slice(0, 40))) : false; };

async function backfill(channelId: string) {
  const ch = await prismaAdmin.channel.findUnique({ where: { id: channelId } });
  if (!ch || ch.status !== 'ACTIVE') return 'skip';
  const { connector, creds } = await credsFor(ch);
  const until = new Date(), since = new Date(Date.now() - 90 * 864e5);
  if (connector.collectChannelMetrics) { for (let s = since; s < until; s = new Date(s.getTime() + 30 * 864e5)) { const e = new Date(Math.min(until.getTime(), s.getTime() + 30 * 864e5)); const rows = await connector.collectChannelMetrics({ channel: ch, creds, since: s, until: e }).catch(() => []); await upsertChannelMetrics(ch.id, rows); } }
  await discover(ch).catch(() => 0);
  await prismaAdmin.channel.update({ where: { id: ch.id }, data: { metricsCursor: new Date() } });
  return 'ok';
}

/** Instagram story_insights webhook payload → persist (stories vanish after 24h). */
async function storyInsights({ channelId, value }: { channelId: string; value: any }) {
  const t = await prismaAdmin.postTarget.findFirst({ where: { channelId, externalPostId: value.media_id } });
  if (!t) return 'no-target';
  const rows = Object.entries(value).filter(([k]) => !['media_id'].includes(k)).map(([metric, v]) => ({ externalPostId: value.media_id, metric: ({ impressions: 'impressions', reach: 'reach', replies: 'replies', exits: 'exits', taps_forward: 'taps_forward', taps_back: 'taps_back' } as any)[metric] ?? metric, value: Number(v) }));
  await insertPostMetrics(new Map([[value.media_id, t.id]]), rows);
  return 'ok';
}
