import { Worker } from 'bullmq';
import { prismaAdmin } from '@relay/db';
import { connection, queue, log } from './infra.js';

const LOOKAHEAD_MS = 15 * 60_000;

/**
 * Every minute: look ahead 15 minutes and enqueue a delayed job for each due target.
 * Job ids are deterministic (targetId:dueAtEpoch) so re-runs are idempotent. Nothing publishes here.
 */
export function dispatcherWorker() {
  return new Worker('dispatcher', async () => {
    const now = Date.now();
    const due = await prismaAdmin.postTarget.findMany({
      where: { status: { in: ['QUEUED', 'SCHEDULED'] }, dueAt: { lte: new Date(now + LOOKAHEAD_MS) }, lockedBy: null, channel: { status: 'ACTIVE', isPaused: false, deletedAt: null }, post: { deletedAt: null } },
      select: { id: true, dueAt: true, schedulingType: true, channelId: true, organizationId: true },
      take: 5000,
    });
    if (!due.length) return 'idle';
    const byQueue: Record<string, any[]> = { publish: [], notify: [] };
    for (const t of due) {
      const qn = t.schedulingType === 'NOTIFICATION' ? 'notify' : 'publish';
      byQueue[qn].push({ name: qn, data: { targetId: t.id, channelId: t.channelId, organizationId: t.organizationId }, opts: { jobId: `${t.id}-${t.dueAt!.getTime()}`, delay: Math.max(0, t.dueAt!.getTime() - now), attempts: 1 } });
    }
    for (const [qn, jobs] of Object.entries(byQueue)) if (jobs.length) await queue(qn).addBulk(jobs);
    log.debug({ count: due.length }, 'dispatched');
    return `dispatched:${due.length}`;
  }, { connection, concurrency: 1, lockDuration: 55_000 });
}
