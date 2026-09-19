import { Worker, type Job } from 'bullmq';
import { Prisma, prismaAdmin } from '@cadence/db';
import { getConnector, classifyError, ConnectorError } from '@cadence/connectors';
import { tokenVault } from '@cadence/token-vault';
import { rulesFor, validateTarget, hasErrors } from '@cadence/network-rules';
import { env } from '@cadence/config';
import { connection, queue, log, emit, WORKER_ID } from './infra.js';
import { RateBudget } from './rate-budget.js';
import { sendMail } from './mail.js';
import { scheduleBoostIfOptedIn } from './boost.processor.js';

const BACKOFF_MS = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000, 3 * 60 * 60_000];

export function publishWorker() {
  return new Worker('publish', async (job: Job) => processPublishJob(job.data), { connection, concurrency: Number(process.env.PUBLISH_CONCURRENCY ?? 32), lockDuration: 12 * 60_000 });
}

export async function processPublishJob({ targetId }: { targetId: string }) {
  // 1) Atomic claim: only one worker moves QUEUED/SCHEDULED → PUBLISHING
  const claimed = await prismaAdmin.$queryRaw<{ id: string }[]>(Prisma.sql`
    UPDATE "PostTarget" SET status = 'PUBLISHING', "lockedBy" = ${WORKER_ID}, "lockedAt" = now(), "attemptCount" = "attemptCount" + 1, "lastAttemptAt" = now()
    WHERE id = ${targetId}::uuid AND status IN ('QUEUED','SCHEDULED') AND "dueAt" IS NOT NULL AND "dueAt" <= now() + interval '5 seconds'
      AND ("lockedAt" IS NULL OR "lockedAt" < now() - interval '10 minutes')
    RETURNING id`);
  if (!claimed.length) return 'skipped:not-claimable';

  const target = await prismaAdmin.postTarget.findUniqueOrThrow({ where: { id: targetId }, include: { channel: true, post: true } });
  const { channel } = target;
  const connector = getConnector(channel.network);

  // Resolve inherited text/media from the parent post (non-customised targets follow later edits to the base)
  const effective = { ...target, text: target.customized ? target.text : (target.post.baseText || target.text), media: target.customized ? target.media : ((target.post.baseMedia as any[])?.length ? target.post.baseMedia : target.media) } as typeof target;

  // 2) Guard rails: channel state, pre-flight validation, platform budget
  if (channel.status !== 'ACTIVE' || channel.isPaused || channel.deletedAt) return release(target, target.isCustomTime ? 'SCHEDULED' : 'QUEUED', 'Channel not active');
  const issues = validateTarget(rulesFor(channel.network), { text: effective.text, media: effective.media as any, thread: effective.thread as any, metadata: effective.metadata as any, firstComment: effective.firstComment ?? undefined }, { channel: { meta: channel.meta as any, subtype: channel.subtype }, metadata: effective.metadata as any, media: effective.media as any, premium: !!(channel.meta as any)?.premium });
  if (hasErrors(issues)) return fail(target, new ConnectorError('VALIDATION', issues.filter(i => i.level === 'error').map(i => i.message).join('; '), { retryable: false }));
  const budget = await RateBudget.tryConsume(connector.publishBudget(target, channel));
  if (!budget.ok) return defer(target, budget.retryAt, 'RATE_LIMIT', budget.reason);

  // 3) Publish
  try {
    const creds = await tokenVault.forChannel(channel.id, channel, connector.refresh.bind(connector));
    const result = await connector.publish({ target: effective, channel, creds, idempotencyKey: `${target.id}:${target.attemptCount}` });
    await prismaAdmin.postTarget.update({ where: { id: target.id }, data: { status: 'PUBLISHED', publishedAt: new Date(), externalPostId: result.externalId, externalUrl: result.url ?? null, lockedBy: null, lockedAt: null, failureCode: null, failureMessage: null, metadata: { ...(target.metadata as any), publishExtra: result.extra ?? undefined } } });
    await rollupPostStatus(target.postId);
    await queue('metrics').add('bootstrap', { targetId: target.id, organizationId: target.organizationId }, { delay: 30 * 60_000, jobId: `bootstrap-${target.id}` });
    await scheduleBoostIfOptedIn({ id: target.id, organizationId: target.organizationId, channel: { network: channel.network }, post: { autoRepost: (target.post as any).autoRepost, boostedAt: (target.post as any).boostedAt } });
    await emit(target.organizationId, { type: 'target.published', targetId: target.id, url: result.url });
    await emit(target.organizationId, { type: 'queue.changed', channelId: channel.id });
    log.info({ targetId: target.id, network: channel.network, externalId: result.externalId }, 'published');
    return 'published';
  } catch (err) {
    const c = classifyError(err);
    log.warn({ targetId: target.id, network: channel.network, code: c.code, msg: c.message }, 'publish failed');
    if (c.code === 'AUTH') {
      await prismaAdmin.channel.update({ where: { id: channel.id }, data: { status: 'RECONNECT_REQUIRED', statusReason: c.message.slice(0, 250) } });
      await release(target, target.isCustomTime ? 'SCHEDULED' : 'QUEUED', c.message, 'AUTH');
      await notifyReconnect(channel);
      await emit(target.organizationId, { type: 'channel.updated', channelId: channel.id });
      return 'paused:auth';
    }
    if (c.retryable && target.attemptCount <= BACKOFF_MS.length) {
      return defer(target, new Date(Date.now() + (c.retryAfterMs ?? BACKOFF_MS[target.attemptCount - 1] ?? BACKOFF_MS.at(-1)!)), c.code, c.message);
    }
    return fail(target, c);
  }
}

async function release(t: any, status: 'QUEUED' | 'SCHEDULED', message?: string, code?: string) {
  await prismaAdmin.postTarget.update({ where: { id: t.id }, data: { status, lockedBy: null, lockedAt: null, ...(code ? { failureCode: code, failureMessage: message?.slice(0, 500) } : {}) } });
  return `released:${status}`;
}
async function defer(t: any, retryAt: Date, code: string, message: string) {
  await prismaAdmin.postTarget.update({ where: { id: t.id }, data: { status: 'SCHEDULED', isCustomTime: true, dueAt: retryAt, lockedBy: null, lockedAt: null, failureCode: code, failureMessage: message.slice(0, 500) } });
  await queue('publish').add('publish', { targetId: t.id, channelId: t.channelId, organizationId: t.organizationId }, { jobId: `${t.id}-${retryAt.getTime()}`, delay: Math.max(0, retryAt.getTime() - Date.now()), attempts: 1 });
  await emit(t.organizationId, { type: 'target.updated', targetId: t.id });
  return `deferred:${code}`;
}
async function fail(t: any, c: ConnectorError) {
  await prismaAdmin.postTarget.update({ where: { id: t.id }, data: { status: 'FAILED', lockedBy: null, lockedAt: null, dueAt: null, queuePosition: null, failureCode: c.code, failureMessage: c.message.slice(0, 500) } });
  await rollupPostStatus(t.postId);
  await emit(t.organizationId, { type: 'target.failed', targetId: t.id, code: c.code, message: c.message });
  await notifyFailure(t, c);
  return `failed:${c.code}`;
}

/** Parent post status = derived from its targets. */
export async function rollupPostStatus(postId: string) {
  const targets = await prismaAdmin.postTarget.findMany({ where: { postId }, select: { status: true } });
  const s = new Set(targets.map(t => t.status));
  const status = s.size === 1 ? [...s][0] : s.has('PUBLISHED') && (s.has('FAILED') || s.has('QUEUED') || s.has('SCHEDULED')) ? 'PARTIALLY_PUBLISHED' : s.has('FAILED') ? 'FAILED' : s.has('PUBLISHING') ? 'PUBLISHING' : s.has('SCHEDULED') ? 'SCHEDULED' : 'QUEUED';
  await prismaAdmin.post.update({ where: { id: postId }, data: { status: status as any } }).catch(() => undefined);
}

async function notifyFailure(t: any, c: ConnectorError) {
  const post = await prismaAdmin.post.findUnique({ where: { id: t.postId } }); if (!post) return;
  const [account, channel] = await Promise.all([prismaAdmin.account.findUnique({ where: { id: post.createdByAccountId } }), prismaAdmin.channel.findUnique({ where: { id: t.channelId } })]);
  if (!account || !channel) return;
  if (await prefOff(account.id, 'post_failed')) return;
  await sendMail({ to: account.email, template: 'post_failed', data: { channel: channel.displayName, reason: c.message, url: `${env.APP_URL}/channels/${channel.id}/queue` } });
}
async function notifyReconnect(channel: any) {
  const admins = await prismaAdmin.membership.findMany({ where: { organizationId: channel.organizationId, status: 'ACTIVE', role: { in: ['OWNER', 'ADMIN'] } }, include: { account: true } });
  for (const m of admins) if (!(await prefOff(m.accountId, 'channel_connection'))) await sendMail({ to: m.account.email, template: 'channel_reconnect', data: { channel: channel.displayName, url: `${env.APP_URL}/channels` } });
}
async function prefOff(accountId: string, key: string) { const p = await prismaAdmin.notificationPref.findUnique({ where: { accountId_key: { accountId, key } } }); return p ? !p.enabled : false; }
