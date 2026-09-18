import { builder } from '../builder.js';
import { prismaAdmin } from '@relay/db';
import { QueueOps, assertCan, DomainError } from '@relay/domain';
import { QueuesService } from '../../infra/queues.service.js';
import { events } from '../../events/events.bus.js';

const queues = new QueuesService();

async function target(ctx: any, id: string) {
  const t = await ctx.db.postTarget.findFirstOrThrow({ where: { id, organizationId: ctx.tenant.organizationId }, include: { channel: true } });
  assertCan(ctx.tenant, 'post.publish', t.channelId);
  if (t.status === 'PUBLISHED' || t.status === 'PUBLISHING') throw new DomainError('CONFLICT', 'This post has already been published');
  return t;
}
const done = (ctx: any, channelId: string) => events.publish(ctx.tenant.organizationId, { type: 'queue.changed', channelId });

builder.mutationFields(t => ({
  moveToTop: t.boolean({ authScopes: { user: true }, args: { targetId: t.arg.id({ required: true }) }, resolve: async (_r, a, ctx) => { const x = await target(ctx, String(a.targetId)); await new QueueOps(prismaAdmin).moveToTop(x.id, x.channelId); done(ctx, x.channelId); return true; } }),
  moveTarget: t.boolean({ authScopes: { user: true }, args: { targetId: t.arg.id({ required: true }), direction: t.arg.string({ required: true }) }, resolve: async (_r, a, ctx) => { const x = await target(ctx, String(a.targetId)); await new QueueOps(prismaAdmin).moveBy(x.id, x.channelId, a.direction === 'up' ? -1 : 1); done(ctx, x.channelId); return true; } }),
  swapTargets: t.boolean({ authScopes: { user: true }, args: { aId: t.arg.id({ required: true }), bId: t.arg.id({ required: true }) }, resolve: async (_r, a, ctx) => { const x = await target(ctx, String(a.aId)); const y = await target(ctx, String(a.bId)); if (x.channelId !== y.channelId) throw new DomainError('VALIDATION', 'Posts must be in the same queue'); await new QueueOps(prismaAdmin).swap(x.id, y.id, x.channelId); done(ctx, x.channelId); return true; } }),
  moveToNextSlot: t.boolean({ authScopes: { user: true }, args: { targetId: t.arg.id({ required: true }) }, resolve: async (_r, a, ctx) => { const x = await target(ctx, String(a.targetId)); await new QueueOps(prismaAdmin).addToQueue(x.id, x.channelId); done(ctx, x.channelId); return true; } }),
  setTargetTime: t.boolean({ authScopes: { user: true }, args: { targetId: t.arg.id({ required: true }), dueAt: t.arg({ type: 'DateTime', required: true }) }, resolve: async (_r, a, ctx) => { const x = await target(ctx, String(a.targetId)); if (a.dueAt.getTime() < Date.now() - 60_000) throw new DomainError('VALIDATION', 'That time is in the past'); await new QueueOps(prismaAdmin).setCustomTime(x.id, x.channelId, a.dueAt); done(ctx, x.channelId); return true; } }),
  addToQueue: t.boolean({ authScopes: { user: true }, args: { targetId: t.arg.id({ required: true }) }, resolve: async (_r, a, ctx) => { const x = await target(ctx, String(a.targetId)); await new QueueOps(prismaAdmin).addToQueue(x.id, x.channelId); await ctx.db!.post.updateMany({ where: { id: x.postId, status: { in: ['DRAFT', 'FAILED'] } }, data: { status: 'QUEUED' } }); done(ctx, x.channelId); return true; } }),
  shareNow: t.boolean({ authScopes: { user: true }, args: { targetId: t.arg.id({ required: true }) }, resolve: async (_r, a, ctx) => { const x = await target(ctx, String(a.targetId)); await new QueueOps(prismaAdmin).shareNow(x.id); await queues.enqueuePublish({ id: x.id, channelId: x.channelId, organizationId: x.organizationId, dueAt: new Date(), schedulingType: x.schedulingType }); done(ctx, x.channelId); return true; } }),
  retryNow: t.boolean({ authScopes: { user: true }, args: { targetId: t.arg.id({ required: true }) }, resolve: async (_r, a, ctx) => { const x = await target(ctx, String(a.targetId)); if (x.status !== 'FAILED') throw new DomainError('VALIDATION', 'Only failed posts can be retried'); if (x.channel.status !== 'ACTIVE') throw new DomainError('VALIDATION', `Reconnect ${x.channel.displayName} first`); await ctx.db!.postTarget.update({ where: { id: x.id }, data: { status: 'SCHEDULED', isCustomTime: true, dueAt: new Date(), attemptCount: 0, failureCode: null, failureMessage: null } }); await queues.enqueuePublish({ id: x.id, channelId: x.channelId, organizationId: x.organizationId, dueAt: new Date(), schedulingType: x.schedulingType }); done(ctx, x.channelId); return true; } }),
  moveToDrafts: t.boolean({ authScopes: { user: true }, args: { targetId: t.arg.id({ required: true }) }, resolve: async (_r, a, ctx) => { const x = await target(ctx, String(a.targetId)); await new QueueOps(prismaAdmin).toDraft(x.id, x.channelId); done(ctx, x.channelId); return true; } }),
  markNotificationDone: t.boolean({ authScopes: { user: true }, args: { targetId: t.arg.id({ required: true }), externalUrl: t.arg.string() }, resolve: async (_r, a, ctx) => { const x = await ctx.db!.postTarget.findFirstOrThrow({ where: { id: String(a.targetId), organizationId: ctx.tenant!.organizationId, status: 'NOTIFIED' } }); await ctx.db!.postTarget.update({ where: { id: x.id }, data: { status: 'PUBLISHED', publishedAt: new Date(), externalUrl: a.externalUrl ?? undefined } }); await ctx.db!.notificationJob.updateMany({ where: { postTargetId: x.id }, data: { completedAt: new Date() } }); done(ctx, x.channelId); return true; } }),
}));
