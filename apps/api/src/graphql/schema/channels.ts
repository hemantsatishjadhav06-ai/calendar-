import { builder } from '../builder.js';
import { NetworkEnum, ChannelStatusEnum } from './enums.js';
import { prismaAdmin } from '@cadence/db';
import { QueueOps, assertCan, DomainError, groupSlotsByDay, nextFreeSlots } from '@cadence/domain';
import { getConnector, NETWORK_CATALOG, networkConfigured } from '@cadence/connectors';
import { tokenVault } from '@cadence/token-vault';
import { publicRulesSummary } from '@cadence/network-rules';
import { events } from '../../events/events.bus.js';
import { env } from '@cadence/config';
import { makeConnectToken } from '../../share/share.token.js';

builder.prismaObject('Channel', {
  fields: t => ({
    id: t.exposeID('id'),
    network: t.expose('network', { type: NetworkEnum }),
    subtype: t.exposeString('subtype'),
    externalId: t.exposeString('externalId'),
    displayName: t.exposeString('displayName'),
    handle: t.exposeString('handle', { nullable: true }),
    avatarUrl: t.exposeString('avatarUrl', { nullable: true }),
    timezone: t.exposeString('timezone'),
    status: t.expose('status', { type: ChannelStatusEnum }),
    statusReason: t.exposeString('statusReason', { nullable: true }),
    isPaused: t.exposeBoolean('isPaused'),
    notifyByDefault: t.exposeBoolean('notifyByDefault'),
    postingGoalPerWeek: t.exposeInt('postingGoalPerWeek', { nullable: true }),
    sortOrder: t.exposeInt('sortOrder'),
    meta: t.expose('meta', { type: 'JSON' }),
    connectedAt: t.expose('connectedAt', { type: 'DateTime' }),
    lastHealthCheckAt: t.expose('lastHealthCheckAt', { type: 'DateTime', nullable: true }),
    groupIds: t.field({ type: ['ID'], resolve: async (c, _a, ctx) => (await ctx.db!.channelGroupMember.findMany({ where: { channelId: c.id } })).map(m => m.groupId) }),
    schedule: t.relation('schedule'),
    scheduleByDay: t.field({ type: 'JSON', resolve: async (c, _a, ctx) => groupSlotsByDay(await ctx.db!.postingSlot.findMany({ where: { channelId: c.id } })) }),
    queueCount: t.int({ resolve: (c, _a, ctx) => ctx.db!.postTarget.count({ where: { channelId: c.id, status: { in: ['QUEUED', 'SCHEDULED', 'FAILED'] } } }) }),
    publishedThisWeek: t.int({ resolve: (c, _a, ctx) => { const d = new Date(); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); d.setUTCHours(0, 0, 0, 0); return ctx.db!.postTarget.count({ where: { channelId: c.id, status: 'PUBLISHED', publishedAt: { gte: d } } }); } }),
    myAccess: t.field({ type: 'JSON', resolve: (c, _a, ctx) => ctx.tenant!.role !== 'MEMBER' ? { publish: 'FULL', community: 'FULL' } : (ctx.tenant!.channelPermissions[c.id] ?? { publish: 'NONE', community: 'NONE' }) }),
    groups: t.relation('groups'),
    suggestedSlots: t.field({ type: ['DateTime'], args: { count: t.arg.int({ defaultValue: 5 }) }, resolve: async (c, args, ctx) => { const [slots, taken] = await Promise.all([ctx.db!.postingSlot.findMany({ where: { channelId: c.id } }), ctx.db!.postTarget.findMany({ where: { channelId: c.id, status: { in: ['QUEUED', 'SCHEDULED'] }, dueAt: { not: null } }, select: { dueAt: true } })]); return nextFreeSlots(slots, c.timezone, taken.map(x => x.dueAt!), new Date(), args.count ?? 5); } }),
  }),
});
builder.prismaObject('PostingSlot', { fields: t => ({ id: t.exposeID('id'), weekday: t.exposeInt('weekday'), minuteOfDay: t.exposeInt('minuteOfDay'), enabled: t.exposeBoolean('enabled'), source: t.exposeString('source') }) });
builder.prismaObject('ChannelGroup', { fields: t => ({ id: t.exposeID('id'), name: t.exposeString('name'), channelIds: t.field({ type: ['ID'], resolve: async (g, _a, ctx) => (await ctx.db!.channelGroupMember.findMany({ where: { groupId: g.id } })).map(m => m.channelId) }) }) });
builder.prismaObject('ChannelGroupMember', { fields: t => ({ groupId: t.exposeID('groupId'), channelId: t.exposeID('channelId') }) });

const NetworkInfo = builder.objectRef<{ network: string; label: string; needsHint?: string; note?: string; configured: boolean; rules: any }>('NetworkInfo').implement({
  fields: t => ({ network: t.exposeString('network'), label: t.exposeString('label'), needsHint: t.exposeString('needsHint', { nullable: true }), note: t.exposeString('note', { nullable: true }), configured: t.exposeBoolean('configured'), rules: t.expose('rules', { type: 'JSON' }) }),
});

builder.queryFields(t => ({
  channels: t.prismaField({ type: ['Channel'], authScopes: { user: true }, resolve: (q, _r, _a, ctx) => ctx.db!.channel.findMany({ ...q, where: { organizationId: ctx.tenant!.organizationId, deletedAt: null }, orderBy: [{ sortOrder: 'asc' }, { connectedAt: 'asc' }] }) }),
  channel: t.prismaField({ type: 'Channel', authScopes: { user: true }, args: { id: t.arg.id({ required: true }) }, resolve: (q, _r, args, ctx) => ctx.db!.channel.findFirstOrThrow({ ...q, where: { id: String(args.id), organizationId: ctx.tenant!.organizationId, deletedAt: null } }) }),
  networks: t.field({ type: [NetworkInfo], resolve: () => { const rules = publicRulesSummary(); return NETWORK_CATALOG.map(n => ({ ...n, configured: networkConfigured(n.network), rules: rules.find(r => r.network === n.network) })); } }),
  channelLookup: t.field({
    type: 'JSON', authScopes: { user: true }, args: { channelId: t.arg.id({ required: true }), what: t.arg.string({ required: true }), args: t.arg({ type: 'JSON' }) },
    resolve: async (_r, args, ctx) => {
      const ch = await ctx.db!.channel.findFirstOrThrow({ where: { id: String(args.channelId), organizationId: ctx.tenant!.organizationId } });
      const connector = getConnector(ch.network); if (!connector.lookup) return null;
      const creds = await tokenVault.forChannel(ch.id, ch, connector.refresh.bind(connector));
      return connector.lookup(creds, ch, args.what, (args.args as any) ?? {});
    },
  }),
}));

const SlotInput = builder.inputType('PostingSlotInput', { fields: t => ({ weekday: t.int({ required: true }), minuteOfDay: t.int({ required: true }), enabled: t.boolean({ defaultValue: true }) }) });

builder.mutationFields(t => ({
  // Self-serve connection link: lets a client connect their own channels to this workspace (admin only).
  createConnectionLink: t.string({ authScopes: { admin: true }, resolve: (_r, _a, ctx) => `${env.APP_URL}/connect/${makeConnectToken(ctx.tenant!.organizationId)}` }),
  updateChannel: t.prismaField({
    type: 'Channel', authScopes: { user: true },
    args: { id: t.arg.id({ required: true }), timezone: t.arg.string(), isPaused: t.arg.boolean(), notifyByDefault: t.arg.boolean(), postingGoalPerWeek: t.arg.int(), displayName: t.arg.string(), meta: t.arg({ type: 'JSON' }) },
    resolve: async (q, _r, args, ctx) => {
      const id = String(args.id); assertCan(ctx.tenant!, 'channel.settings', id);
      const ch = await ctx.db!.channel.update({ ...q, where: { id }, data: { ...(args.timezone ? { timezone: args.timezone } : {}), ...(args.isPaused != null ? { isPaused: args.isPaused } : {}), ...(args.notifyByDefault != null ? { notifyByDefault: args.notifyByDefault } : {}), ...(args.postingGoalPerWeek !== undefined ? { postingGoalPerWeek: args.postingGoalPerWeek } : {}), ...(args.displayName ? { displayName: args.displayName } : {}), ...(args.meta ? { meta: args.meta as any } : {}) } });
      if (args.timezone || args.isPaused != null) await new QueueOps(prismaAdmin).reflow(id);
      events.publish(ctx.tenant!.organizationId, { type: 'channel.updated', channelId: id });
      return ch;
    },
  }),
  setPostingSchedule: t.prismaField({
    type: 'Channel', authScopes: { user: true },
    args: { channelId: t.arg.id({ required: true }), slots: t.arg({ type: [SlotInput], required: true }) },
    resolve: async (q, _r, args, ctx) => {
      const id = String(args.channelId); assertCan(ctx.tenant!, 'channel.settings', id);
      for (const s of args.slots) if (s.weekday < 0 || s.weekday > 6 || s.minuteOfDay < 0 || s.minuteOfDay > 1439) throw new DomainError('VALIDATION', 'Invalid slot');
      await ctx.db!.tx(async tx => {
        await tx.postingSlot.deleteMany({ where: { channelId: id } });
        await tx.postingSlot.createMany({ data: args.slots.map(s => ({ channelId: id, weekday: s.weekday, minuteOfDay: s.minuteOfDay, enabled: s.enabled ?? true })), skipDuplicates: true });
      });
      await new QueueOps(prismaAdmin).reflow(id);
      events.publish(ctx.tenant!.organizationId, { type: 'queue.changed', channelId: id });
      return ctx.db!.channel.findUniqueOrThrow({ ...q, where: { id } });
    },
  }),
  shuffleQueue: t.boolean({ authScopes: { user: true }, args: { channelId: t.arg.id({ required: true }) }, resolve: async (_r, args, ctx) => { assertCan(ctx.tenant!, 'channel.settings', String(args.channelId)); await new QueueOps(prismaAdmin).shuffle(String(args.channelId)); events.publish(ctx.tenant!.organizationId, { type: 'queue.changed', channelId: String(args.channelId) }); return true; } }),
  reorderChannels: t.boolean({ authScopes: { user: true }, args: { ids: t.arg.idList({ required: true }) }, resolve: async (_r, args, ctx) => { await ctx.db!.tx(async tx => { for (const [i, id] of args.ids.entries()) await tx.channel.updateMany({ where: { id: String(id), organizationId: ctx.tenant!.organizationId }, data: { sortOrder: i } }); }); return true; } }),
  refreshChannel: t.prismaField({
    type: 'Channel', authScopes: { admin: true }, args: { id: t.arg.id({ required: true }) },
    resolve: async (q, _r, args, ctx) => {
      const ch = await ctx.db!.channel.findFirstOrThrow({ where: { id: String(args.id), organizationId: ctx.tenant!.organizationId } });
      const connector = getConnector(ch.network);
      try {
        const creds = await tokenVault.forChannel(ch.id, ch, connector.refresh.bind(connector), 365 * 864e5);   // force a refresh attempt
        const h = await connector.health(creds, ch);
        const updated = await ctx.db!.channel.update({ ...q, where: { id: ch.id }, data: h.ok ? { status: 'ACTIVE', statusReason: null, lastHealthCheckAt: new Date() } : { status: 'RECONNECT_REQUIRED', statusReason: h.reason, lastHealthCheckAt: new Date() } });
        if (h.ok) await new QueueOps(prismaAdmin).reflow(ch.id);
        return updated;
      } catch (e: any) {
        return ctx.db!.channel.update({ ...q, where: { id: ch.id }, data: { status: 'RECONNECT_REQUIRED', statusReason: e.message?.slice(0, 200), lastHealthCheckAt: new Date() } });
      }
    },
  }),
  removeChannel: t.boolean({ authScopes: { admin: true }, args: { id: t.arg.id({ required: true }) }, resolve: async (_r, args, ctx) => { const { ChannelsService } = await import('../../channels/channels.service.js'); const { QueuesService } = await import('../../infra/queues.service.js'); await new ChannelsService(new QueuesService()).disconnect(ctx.tenant!.organizationId, ctx.tenant!.accountId, String(args.id)); return true; } }),
  createChannelGroup: t.prismaField({ type: 'ChannelGroup', authScopes: { user: true }, args: { name: t.arg.string({ required: true }), channelIds: t.arg.idList({ required: true }) }, resolve: (q, _r, args, ctx) => ctx.db!.channelGroup.create({ ...q, data: { organizationId: ctx.tenant!.organizationId, name: args.name, members: { create: args.channelIds.map(id => ({ channelId: String(id) })) } } }) }),
  updateChannelGroup: t.prismaField({ type: 'ChannelGroup', authScopes: { user: true }, args: { id: t.arg.id({ required: true }), name: t.arg.string(), channelIds: t.arg.idList() }, resolve: async (q, _r, args, ctx) => { const id = String(args.id); if (args.channelIds) { await ctx.db!.channelGroupMember.deleteMany({ where: { groupId: id } }); await ctx.db!.channelGroupMember.createMany({ data: args.channelIds.map(c => ({ groupId: id, channelId: String(c) })) }); } return ctx.db!.channelGroup.update({ ...q, where: { id }, data: { ...(args.name ? { name: args.name } : {}) } }); } }),
  deleteChannelGroup: t.boolean({ authScopes: { user: true }, args: { id: t.arg.id({ required: true }) }, resolve: async (_r, args, ctx) => { await ctx.db!.channelGroup.delete({ where: { id: String(args.id) } }); return true; } }),
}));
