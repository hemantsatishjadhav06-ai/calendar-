import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';
import { env } from '@relay/config';

export const QUEUE_NAMES = ['publish', 'notify', 'media', 'metrics', 'inbox', 'ai', 'mail', 'reports', 'dispatcher', 'housekeeping'] as const;
export type QueueName = (typeof QUEUE_NAMES)[number];

@Injectable()
export class QueuesService implements OnModuleDestroy {
  private queues = new Map<QueueName, Queue>();
  private connection = { url: env.REDIS_URL };
  get(name: QueueName): Queue {
    let q = this.queues.get(name);
    if (!q) { q = new Queue(name, { connection: this.connection as any, defaultJobOptions: { removeOnComplete: 1000, removeOnFail: 5000 } }); this.queues.set(name, q); }
    return q;
  }
  /** Enqueue a publish job for a target that should go out now/at dueAt (share now, approvals, retries). */
  async enqueuePublish(t: { id: string; channelId: string; organizationId: string; dueAt: Date | null; schedulingType: string }) {
    const at = t.dueAt?.getTime() ?? Date.now();
    await this.get(t.schedulingType === 'NOTIFICATION' ? 'notify' : 'publish').add(t.schedulingType === 'NOTIFICATION' ? 'notify' : 'publish', { targetId: t.id, channelId: t.channelId, organizationId: t.organizationId }, { jobId: `${t.id}-${at}`, delay: Math.max(0, at - Date.now()), attempts: 1 });
  }
  async onModuleDestroy() { await Promise.all([...this.queues.values()].map(q => q.close())); }
}
