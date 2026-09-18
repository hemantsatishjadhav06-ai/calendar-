import type { Prisma, PrismaClient } from '@relay/db';
import { assignQueue } from './slots.js';

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * Queue mutations. Every mutation ends with reflow(), which recomputes dueAt for QUEUE-mode targets
 * of the channel. Works with either the admin client (workers) or a tenant-scoped transaction (API).
 */
export class QueueOps {
  constructor(private db: Db) {}

  async reflow(channelId: string, now = new Date()) {
    const ch = await this.db.channel.findUniqueOrThrow({ where: { id: channelId }, include: { schedule: true } });
    const queued = await this.db.postTarget.findMany({
      where: { channelId, status: 'QUEUED', isCustomTime: false, lockedBy: null },
      select: { id: true, queuePosition: true, createdAt: true },
      orderBy: [{ queuePosition: 'asc' }, { createdAt: 'asc' }],
    });
    const custom = await this.db.postTarget.findMany({
      where: { channelId, status: { in: ['QUEUED', 'SCHEDULED'] }, isCustomTime: true, dueAt: { not: null } },
      select: { dueAt: true },
    });
    // A paused channel keeps positions but has no dueAt, so the dispatcher never picks its posts up.
    const assignments = ch.isPaused
      ? queued.map(q => ({ id: q.id, dueAt: null as Date | null }))
      : assignQueue(queued.map((q, i) => ({ id: q.id, queuePosition: i })), custom.map(c => c.dueAt!), ch.schedule, ch.timezone, now);
    for (const [i, q] of queued.entries()) {
      const a = assignments.find(x => x.id === q.id);
      await this.db.postTarget.update({ where: { id: q.id }, data: { queuePosition: i, dueAt: a?.dueAt ?? null } });
    }
  }

  async addToQueue(targetId: string, channelId: string) {
    const max = await this.db.postTarget.aggregate({ where: { channelId, status: 'QUEUED', isCustomTime: false }, _max: { queuePosition: true } });
    await this.db.postTarget.update({ where: { id: targetId }, data: { status: 'QUEUED', isCustomTime: false, queuePosition: (max._max.queuePosition ?? -1) + 1, failureCode: null, failureMessage: null } });
    await this.reflow(channelId);
  }

  /** "Share next" / "Move to top" */
  async moveToTop(targetId: string, channelId: string) {
    await this.db.postTarget.updateMany({ where: { channelId, status: 'QUEUED', isCustomTime: false }, data: { queuePosition: { increment: 1 } } });
    await this.db.postTarget.update({ where: { id: targetId }, data: { status: 'QUEUED', isCustomTime: false, queuePosition: 0, failureCode: null, failureMessage: null } });
    await this.reflow(channelId);
  }

  async moveBy(targetId: string, channelId: string, delta: -1 | 1) {
    const t = await this.db.postTarget.findUniqueOrThrow({ where: { id: targetId }, select: { queuePosition: true } });
    if (t.queuePosition == null) return;
    const other = await this.db.postTarget.findFirst({ where: { channelId, status: 'QUEUED', isCustomTime: false, queuePosition: t.queuePosition + delta }, select: { id: true } });
    if (!other) return;
    await this.swap(targetId, other.id, channelId);
  }

  /** Drag-and-drop: swap positions (Buffer semantics). */
  async swap(aId: string, bId: string, channelId: string) {
    const [a, b] = await Promise.all([aId, bId].map(id => this.db.postTarget.findUniqueOrThrow({ where: { id }, select: { queuePosition: true } })));
    await this.db.postTarget.update({ where: { id: aId }, data: { queuePosition: b.queuePosition } });
    await this.db.postTarget.update({ where: { id: bId }, data: { queuePosition: a.queuePosition } });
    await this.reflow(channelId);
  }

  /** Shuffle the first 200 next-available posts. */
  async shuffle(channelId: string) {
    const ids = (await this.db.postTarget.findMany({ where: { channelId, status: 'QUEUED', isCustomTime: false }, orderBy: { queuePosition: 'asc' }, take: 200, select: { id: true } })).map(x => x.id);
    for (let i = ids.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [ids[i], ids[j]] = [ids[j], ids[i]]; }
    for (const [i, id] of ids.entries()) await this.db.postTarget.update({ where: { id }, data: { queuePosition: i } });
    await this.reflow(channelId);
  }

  async setCustomTime(targetId: string, channelId: string, dueAt: Date) {
    await this.db.postTarget.update({ where: { id: targetId }, data: { status: 'SCHEDULED', isCustomTime: true, dueAt, queuePosition: null, failureCode: null, failureMessage: null } });
    await this.reflow(channelId);
  }

  async shareNow(targetId: string) {
    await this.db.postTarget.update({ where: { id: targetId }, data: { status: 'SCHEDULED', isCustomTime: true, dueAt: new Date(), queuePosition: null } });
  }

  async toDraft(targetId: string, channelId: string) {
    await this.db.postTarget.update({ where: { id: targetId }, data: { status: 'DRAFT', dueAt: null, queuePosition: null, isCustomTime: false } });
    await this.reflow(channelId);
  }

  async setPaused(channelId: string, paused: boolean) {
    await this.db.channel.update({ where: { id: channelId }, data: { isPaused: paused } });
    await this.reflow(channelId);
  }
}
