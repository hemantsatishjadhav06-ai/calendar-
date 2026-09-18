import { Worker, type Job } from 'bullmq';
import { prismaAdmin } from '@cadence/db';
import { getConnector } from '@cadence/connectors';
import { tokenVault } from '@cadence/token-vault';
import { QueueOps } from '@cadence/domain';
import { env } from '@cadence/config';
import { connection, log, emit } from './infra.js';
import { sendMail } from './mail.js';

export function housekeepingWorker() {
  return new Worker('housekeeping', async (job: Job) => {
    switch (job.name) {
      case 'token-health-sweep': return tokenHealthSweep();
      case 'stuck-publishing': return unstick();
      case 'expire-drafts': return expireDrafts();
      case 'empty-queue-alerts': return emptyQueueAlerts();
      case 'comment-digests': return commentDigests();
      case 'pubsub-renew': return renewPubSub();
      case 'meta-user-deletion': return metaUserDeletion(job.data);
      default: return 'unknown';
    }
  }, { connection, concurrency: 2, lockDuration: 30 * 60_000 });
}

/** Nightly: refresh tokens expiring within 7 days; health-check every channel; flag RECONNECT_REQUIRED early. */
async function tokenHealthSweep() {
  const channels = await prismaAdmin.channel.findMany({ where: { deletedAt: null, status: { in: ['ACTIVE', 'RECONNECT_REQUIRED'] }, network: { not: 'START_PAGE' } } });
  let flagged = 0, healed = 0;
  for (const ch of channels) {
    const connector = getConnector(ch.network);
    try {
      const creds = await tokenVault.forChannel(ch.id, ch, connector.refresh.bind(connector), 7 * 864e5);
      const h = await connector.health(creds, ch);
      if (h.ok && ch.status !== 'ACTIVE') { await prismaAdmin.channel.update({ where: { id: ch.id }, data: { status: 'ACTIVE', statusReason: null, lastHealthCheckAt: new Date() } }); await new QueueOps(prismaAdmin).reflow(ch.id); healed++; }
      else if (!h.ok && ch.status === 'ACTIVE') { await prismaAdmin.channel.update({ where: { id: ch.id }, data: { status: 'RECONNECT_REQUIRED', statusReason: h.reason?.slice(0, 250), lastHealthCheckAt: new Date() } }); flagged++; await notifyReconnect(ch); }
      else await prismaAdmin.channel.update({ where: { id: ch.id }, data: { lastHealthCheckAt: new Date() } });
      // Proactive nudges: LinkedIn refresh token nearing its fixed 365-day end; Threads private profiles 90-day grant
      if (creds.refreshExpiresAt && creds.refreshExpiresAt.getTime() - Date.now() < 14 * 864e5 && ch.status === 'ACTIVE') await notifyReconnect(ch, 'expiring');
    } catch (e: any) {
      if (ch.status === 'ACTIVE') { await prismaAdmin.channel.update({ where: { id: ch.id }, data: { status: 'RECONNECT_REQUIRED', statusReason: String(e.message).slice(0, 250), lastHealthCheckAt: new Date() } }); flagged++; await notifyReconnect(ch); }
      await tokenVault.markRefreshFailure(ch.id).catch(() => undefined);
    }
    if (flagged || healed) await emit(ch.organizationId, { type: 'channel.updated', channelId: ch.id });
  }
  log.info({ channels: channels.length, flagged, healed }, 'token health sweep');
  return `flagged:${flagged} healed:${healed}`;
}

/** Targets stuck in PUBLISHING for > 15 min (worker died mid-publish). We cannot know if the network call succeeded → reconcile via listRecentPosts, else requeue once. */
async function unstick() {
  const stuck = await prismaAdmin.postTarget.findMany({ where: { status: 'PUBLISHING', lockedAt: { lt: new Date(Date.now() - 15 * 60_000) } }, include: { channel: true } });
  for (const t of stuck) {
    const connector = getConnector(t.channel.network);
    let recovered = false;
    if (connector.listRecentPosts) {
      try {
        const creds = await tokenVault.forChannel(t.channel.id, t.channel, connector.refresh.bind(connector));
        const recent = await connector.listRecentPosts(creds, t.channel, new Date(Date.now() - 2 * 3600_000));
        const match = recent.find(r => (r.text ?? '').trim().slice(0, 60) === t.text.trim().slice(0, 60));
        if (match) { await prismaAdmin.postTarget.update({ where: { id: t.id }, data: { status: 'PUBLISHED', publishedAt: match.createdAt, externalPostId: match.externalId, externalUrl: match.url, lockedBy: null, lockedAt: null } }); recovered = true; }
      } catch { /* fall through */ }
    }
    if (!recovered) {
      if (t.attemptCount >= 3) await prismaAdmin.postTarget.update({ where: { id: t.id }, data: { status: 'FAILED', lockedBy: null, lockedAt: null, failureCode: 'PLATFORM', failureMessage: 'Publishing was interrupted; please check the network and retry' } });
      else await prismaAdmin.postTarget.update({ where: { id: t.id }, data: { status: 'SCHEDULED', isCustomTime: true, dueAt: new Date(Date.now() + 60_000), lockedBy: null, lockedAt: null } });
    }
    await emit(t.organizationId, { type: 'target.updated', targetId: t.id });
  }
  return `unstuck:${stuck.length}`;
}

async function expireDrafts() {
  // Custom-time drafts whose intended time passed are flagged (UI shows "expired") — we store it in metadata to keep DRAFT status semantics
  const r = await prismaAdmin.$executeRaw`UPDATE "PostTarget" SET metadata = metadata || '{"expired": true}' WHERE status = 'DRAFT' AND "isCustomTime" = true AND "dueAt" < now() AND coalesce(metadata->>'expired','false') <> 'true'`;
  return `expired:${r}`;
}

async function emptyQueueAlerts() {
  const channels = await prismaAdmin.channel.findMany({ where: { status: 'ACTIVE', deletedAt: null, isPaused: false, network: { not: 'START_PAGE' } } });
  let sent = 0;
  for (const ch of channels) {
    const n = await prismaAdmin.postTarget.count({ where: { channelId: ch.id, status: { in: ['QUEUED', 'SCHEDULED'] } } });
    if (n > 0) continue;
    const owner = await prismaAdmin.account.findUnique({ where: { id: ch.connectedByAccountId } });
    if (!owner) continue;
    const pref = await prismaAdmin.notificationPref.findUnique({ where: { accountId_key: { accountId: owner.id, key: 'empty_queue' } } });
    if (pref && !pref.enabled) continue;
    await sendMail({ to: owner.email, template: 'empty_queue', data: { channel: ch.displayName, url: `${env.APP_URL}/channels/${ch.id}/queue` } }); sent++;
  }
  return `sent:${sent}`;
}

/** Hourly digest of unanswered comments during the first 24h after a post; then daily. */
async function commentDigests() {
  const orgs = await prismaAdmin.organization.findMany({ where: { deletedAt: null }, include: { memberships: { where: { status: 'ACTIVE' }, include: { account: true } } } });
  let sent = 0;
  for (const org of orgs) {
    const fresh = await prismaAdmin.comment.count({ where: { organizationId: org.id, repliedAt: null, resolvedAt: null, isOurs: false, externalCreatedAt: { gte: new Date(Date.now() - 3600_000) } } });
    if (!fresh) continue;
    const total = await prismaAdmin.comment.count({ where: { organizationId: org.id, repliedAt: null, resolvedAt: null, isOurs: false } });
    for (const m of org.memberships) {
      const pref = await prismaAdmin.notificationPref.findUnique({ where: { accountId_key: { accountId: m.accountId, key: 'comment_digest' } } });
      if (pref && !pref.enabled) continue;
      await sendMail({ to: m.account.email, template: 'digest_comments', data: { count: total, url: `${env.APP_URL}/community` } }); sent++;
    }
  }
  return `digests:${sent}`;
}

async function renewPubSub() {
  const yt = await prismaAdmin.channel.findMany({ where: { network: 'YOUTUBE', status: 'ACTIVE', deletedAt: null } });
  for (const ch of yt) await fetch('https://pubsubhubbub.appspot.com/subscribe', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ 'hub.callback': `${env.API_URL}/webhooks/youtube`, 'hub.mode': 'subscribe', 'hub.topic': `https://www.youtube.com/feeds/videos.xml?channel_id=${ch.externalId}`, 'hub.verify': 'async', 'hub.lease_seconds': '864000', 'hub.secret': env.YT_HUB_SECRET }) }).catch(() => undefined);
  return `renewed:${yt.length}`;
}

/** Meta data-deletion callback: remove channels + credentials connected by that Facebook user id. */
async function metaUserDeletion({ userId }: { userId: string }) {
  const channels = await prismaAdmin.channel.findMany({ where: { network: { in: ['FACEBOOK', 'INSTAGRAM', 'THREADS'] }, deletedAt: null } });
  let n = 0;
  for (const ch of channels) {
    const creds = await tokenVault.load(ch.id).catch(() => null);
    if (creds?.extra?.fbUserId === userId || ch.externalId === userId) { await prismaAdmin.channel.update({ where: { id: ch.id }, data: { deletedAt: new Date(), status: 'DISCONNECTED', statusReason: 'Removed at user request (Meta)' } }); await tokenVault.delete(ch.id); n++; }
  }
  return `deleted:${n}`;
}

async function notifyReconnect(ch: any, kind: 'now' | 'expiring' = 'now') {
  const admins = await prismaAdmin.membership.findMany({ where: { organizationId: ch.organizationId, status: 'ACTIVE', role: { in: ['OWNER', 'ADMIN'] } }, include: { account: true } });
  for (const m of admins) await sendMail({ to: m.account.email, template: 'channel_reconnect', data: { channel: `${ch.displayName}${kind === 'expiring' ? ' (access expires soon)' : ''}`, url: `${env.APP_URL}/channels` } });
}
