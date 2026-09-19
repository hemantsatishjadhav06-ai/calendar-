import { prismaAdmin } from '@cadence/db';
import { events } from '../events/events.bus.js';

export interface NotifyInput { organizationId: string; accountId: string; type: string; title: string; body?: string; url?: string; data?: Record<string, any> }

/**
 * Create an in-app notification (top-bar bell) for one recipient and nudge their live count.
 * Uses the admin client because a notification is often created for a different account than the actor.
 * Best-effort: never throws into the caller's request path.
 */
export async function pushNotification(n: NotifyInput): Promise<void> {
  try {
    await prismaAdmin.notification.create({ data: { organizationId: n.organizationId, accountId: n.accountId, type: n.type, title: n.title.slice(0, 200), body: n.body?.slice(0, 500) ?? null, url: n.url ?? null, data: (n.data ?? {}) as any } });
    events.publish(n.organizationId, { type: 'notification.created', accountId: n.accountId });
  } catch { /* notifications are best-effort */ }
}

/** Fan out the same notification to several recipients (e.g. all approvers), skipping the actor. */
export async function pushToMany(recipients: string[], n: Omit<NotifyInput, 'accountId'>, exceptAccountId?: string): Promise<void> {
  await Promise.all([...new Set(recipients)].filter(id => id !== exceptAccountId).map(accountId => pushNotification({ ...n, accountId })));
}
