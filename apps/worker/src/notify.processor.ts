import { Worker, type Job } from 'bullmq';
import { Prisma, prismaAdmin } from '@cadence/db';
import { env } from '@cadence/config';
import { connection, queue, emit, WORKER_ID } from './infra.js';
import { sendMail } from './mail.js';
import { rollupPostStatus } from './publish.processor.js';

/** "Notify me" reminders: at dueAt, mark NOTIFIED and send the reminder (email now; mobile push when the app exists). Re-send once after 2h if unfinished. */
export function notifyWorker() {
  return new Worker('notify', async (job: Job) => {
    const { targetId, resend } = job.data as { targetId: string; resend?: boolean };
    if (resend) {
      const t = await prismaAdmin.postTarget.findUnique({ where: { id: targetId }, include: { channel: true, post: true, notification: true } });
      if (!t || t.status !== 'NOTIFIED' || t.notification?.completedAt) return 'skip';
      await remind(t); await prismaAdmin.notificationJob.update({ where: { postTargetId: t.id }, data: { resentAt: new Date() } });
      return 'resent';
    }
    const claimed = await prismaAdmin.$queryRaw<{ id: string }[]>(Prisma.sql`UPDATE "PostTarget" SET status = 'NOTIFIED', "lockedBy" = ${WORKER_ID}, "lockedAt" = now(), "attemptCount" = "attemptCount" + 1 WHERE id = ${targetId}::uuid AND status IN ('QUEUED','SCHEDULED') AND "dueAt" <= now() + interval '5 seconds' RETURNING id`);
    if (!claimed.length) return 'skipped';
    const t = await prismaAdmin.postTarget.findUniqueOrThrow({ where: { id: targetId }, include: { channel: true, post: true } });
    await prismaAdmin.notificationJob.upsert({ where: { postTargetId: t.id }, create: { postTargetId: t.id, sentAt: new Date() }, update: { sentAt: new Date() } });
    await remind(t);
    await prismaAdmin.postTarget.update({ where: { id: t.id }, data: { lockedBy: null, lockedAt: null } });
    await rollupPostStatus(t.postId);
    await queue('notify').add('notify', { targetId: t.id, resend: true }, { delay: 2 * 3600_000, jobId: `${t.id}-resend` });
    await emit(t.organizationId, { type: 'target.updated', targetId: t.id });
    return 'notified';
  }, { connection, concurrency: 8 });
}

async function remind(t: any) {
  const account = await prismaAdmin.account.findUnique({ where: { id: t.post.createdByAccountId } });
  if (!account) return;
  await sendMail({ to: account.email, template: 'notify_me', data: { channel: t.channel.displayName, url: `${env.APP_URL}/notify/${t.id}` } });
}
