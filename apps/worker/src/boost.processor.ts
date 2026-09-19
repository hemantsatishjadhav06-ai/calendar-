import { Worker, type Job } from 'bullmq';
import { prismaAdmin } from '@cadence/db';
import { connection, queue, log, emit } from './infra.js';

/** Networks that support reposting/boosting the same content (shoutrrr parity: X, LinkedIn, Bluesky). */
export const REPOST_CAPABLE = new Set(['X', 'LINKEDIN', 'BLUESKY']);
/** Delay before a boost is evaluated/fired after the original publishes. */
const BOOST_DELAY_MS = Number(process.env.BOOST_DELAY_MS ?? 48 * 3600_000);
/** SMART: only repost if the original earned at least this much engagement by evaluation time. */
const SMART_THRESHOLD = Number(process.env.BOOST_SMART_THRESHOLD ?? 10);
const ENGAGEMENT = new Set(['likes', 'comments', 'shares', 'saves', 'reactions', 'reposts', 'quotes', 'replies', 'retweets', 'reblogs', 'favourites', 'favorites']);

/**
 * After a repost-capable target publishes, schedule a delayed boost when the post opts in.
 * Called from the publish processor's success path; a no-op unless the post opted in.
 */
export async function scheduleBoostIfOptedIn(target: { id: string; organizationId: string; channel: { network: string }; post: { autoRepost: string; boostedAt: Date | null } }) {
  if (target.post.autoRepost === 'OFF' || target.post.boostedAt) return;
  if (!REPOST_CAPABLE.has(target.channel.network)) return;
  await queue('boost').add('boost', { targetId: target.id, organizationId: target.organizationId }, { delay: BOOST_DELAY_MS, jobId: `boost-${target.id}` });
  log.info({ targetId: target.id, mode: target.post.autoRepost }, 'boost scheduled');
}

/** Latest captured value for each engagement metric, summed. */
async function engagementScore(targetId: string): Promise<number> {
  const rows = await prismaAdmin.postMetric.findMany({ where: { postTargetId: targetId, metric: { in: [...ENGAGEMENT] } }, orderBy: { capturedAt: 'asc' } });
  const latest = new Map<string, number>();
  for (const r of rows) latest.set(r.metric, r.value); // asc order → last write per metric wins
  let sum = 0; for (const v of latest.values()) sum += v;
  return sum;
}

export async function processBoostJob({ targetId }: { targetId: string }) {
  const target = await prismaAdmin.postTarget.findUnique({ where: { id: targetId }, include: { post: true, channel: true } });
  if (!target || !target.post || target.post.deletedAt) return 'skipped:gone';
  if (target.post.boostedAt || target.post.autoRepost === 'OFF') return 'skipped:already-or-off';
  const { channel, post } = target;
  if (channel.status !== 'ACTIVE' || channel.isPaused || channel.deletedAt) return 'skipped:channel';
  if (target.status !== 'PUBLISHED' || !target.externalPostId) return 'skipped:not-published';

  // Claim the boost by stamping boostedAt first (idempotent: a second run sees it set and bails).
  const claim = await prismaAdmin.post.updateMany({ where: { id: post.id, boostedAt: null }, data: { boostedAt: new Date() } });
  if (claim.count === 0) return 'skipped:raced';

  if (post.autoRepost === 'SMART') {
    const score = await engagementScore(target.id);
    if (score < SMART_THRESHOLD) { log.info({ targetId: target.id, score, threshold: SMART_THRESHOLD }, 'boost skipped: below threshold'); return `skipped:below-threshold:${score}`; }
    log.info({ targetId: target.id, score }, 'boost: threshold met');
  }

  // Resolve the exact content that was published (mirror publish.processor's effective-content rule).
  const text = target.customized ? target.text : (post.baseText || target.text);
  const media = target.customized ? target.media : (((post.baseMedia as any[])?.length) ? post.baseMedia : target.media);

  const repost = await prismaAdmin.post.create({
    data: {
      organizationId: post.organizationId, createdByAccountId: post.createdByAccountId,
      status: 'QUEUED', scheduleMode: 'NOW', baseText: text as string, baseMedia: media as any,
      autoRepost: 'OFF', // never chain-boost a boost
      targets: { create: [{
        organizationId: post.organizationId, channelId: channel.id, status: 'QUEUED', schedulingType: target.schedulingType,
        dueAt: new Date(), customized: true, text: text as string, media: media as any, thread: target.thread as any,
        firstComment: target.firstComment, metadata: (target.metadata as any) ?? {},
      }] },
    },
    include: { targets: true },
  });
  await emit(post.organizationId, { type: 'queue.changed', channelId: channel.id });
  log.info({ originalTargetId: target.id, repostPostId: repost.id }, 'boost: repost queued');
  return `boosted:${repost.id}`;
}

export function boostWorker() {
  return new Worker('boost', async (job: Job) => processBoostJob(job.data), { connection, concurrency: 8 });
}
