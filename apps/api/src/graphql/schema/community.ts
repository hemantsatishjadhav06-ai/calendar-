import { builder } from '../builder.js';
import { CommentKindEnum } from './enums.js';
import { prismaAdmin } from '@relay/db';
import { assertCan, can, DomainError } from '@relay/domain';
import { getConnector } from '@relay/connectors';
import { tokenVault } from '@relay/token-vault';
import { events } from '../../events/events.bus.js';
import { QueuesService } from '../../infra/queues.service.js';

const queues = new QueuesService();

builder.prismaObject('Comment', {
  fields: t => ({
    id: t.exposeID('id'), channel: t.relation('channel'), channelId: t.exposeID('channelId'), postTargetId: t.exposeID('postTargetId', { nullable: true }), postTarget: t.relation('postTarget', { nullable: true }),
    externalPostId: t.exposeString('externalPostId', { nullable: true }), externalId: t.exposeString('externalId'), parentExternalId: t.exposeString('parentExternalId', { nullable: true }),
    kind: t.expose('kind', { type: CommentKindEnum }), authorName: t.exposeString('authorName', { nullable: true }), authorHandle: t.exposeString('authorHandle', { nullable: true }), authorAvatarUrl: t.exposeString('authorAvatarUrl', { nullable: true }),
    text: t.exposeString('text'), attachments: t.expose('attachments', { type: 'JSON' }), externalCreatedAt: t.expose('externalCreatedAt', { type: 'DateTime' }), likeCount: t.exposeInt('likeCount'),
    isHidden: t.exposeBoolean('isHidden'), isOurs: t.exposeBoolean('isOurs'), repliedAt: t.expose('repliedAt', { type: 'DateTime', nullable: true }), resolvedAt: t.expose('resolvedAt', { type: 'DateTime', nullable: true }),
    labels: t.exposeStringList('labels'), sentiment: t.exposeFloat('sentiment', { nullable: true }), triage: t.exposeString('triage', { nullable: true }),
    replies: t.prismaField({ type: ['Comment'], resolve: (query, c, _a, ctx) => ctx.db!.comment.findMany({ ...query, where: { channelId: c.channelId, parentExternalId: c.externalId }, orderBy: { externalCreatedAt: 'asc' } }) }),
    capabilities: t.field({ type: 'JSON', resolve: async c => { const ch = await prismaAdmin.channel.findUnique({ where: { id: c.channelId } }); const f = ch ? getConnector(ch.network).rules.features : {}; return { reply: !!(f as any).reply, like: !!(f as any).like, hide: !!(f as any).hide, delete: !!(f as any).deleteComment }; } }),
  }),
});

const CommentFilter = builder.inputType('CommentFilter', { fields: t => ({ channelIds: t.idList(), groupId: t.id(), unansweredOnly: t.boolean(), includeResolved: t.boolean(), kinds: t.field({ type: [CommentKindEnum] }), labels: t.stringList(), search: t.string(), postExternalId: t.string() }) });
const PostGroup = builder.objectRef<{ externalPostId: string; channelId: string; count: number; unanswered: number; latestAt: Date }>('CommentPostGroup').implement({ fields: t => ({ externalPostId: t.exposeString('externalPostId'), channelId: t.exposeID('channelId'), count: t.exposeInt('count'), unanswered: t.exposeInt('unanswered'), latestAt: t.expose('latestAt', { type: 'DateTime' }), postTarget: t.prismaField({ type: 'PostTarget', nullable: true, resolve: (q, g, _a, ctx) => ctx.db!.postTarget.findFirst({ ...q, where: { channelId: g.channelId, externalPostId: g.externalPostId } }) }) }) });

function visibleChannels(ctx: any, requested?: string[]) {
  const all = ctx.tenant.role !== 'MEMBER' ? null : Object.entries(ctx.tenant.channelPermissions as Record<string, any>).filter(([, p]) => p.community !== 'NONE').map(([id]) => id);
  if (!requested?.length) return all;
  return requested.filter(id => !all || all.includes(id));
}
async function where(ctx: any, f: any) {
  let channelIds = visibleChannels(ctx, f?.channelIds?.map(String));
  if (f?.groupId) { const members = await ctx.db.channelGroupMember.findMany({ where: { groupId: String(f.groupId) } }); const g = members.map((m: any) => m.channelId); channelIds = channelIds ? channelIds.filter(id => g.includes(id)) : g; }
  return {
    organizationId: ctx.tenant.organizationId, isOurs: false, isDeleted: false,
    ...(channelIds ? { channelId: { in: channelIds } } : {}),
    ...(f?.unansweredOnly ? { repliedAt: null } : {}),
    ...(f?.includeResolved ? {} : { resolvedAt: null }),
    ...(f?.kinds?.length ? { kind: { in: f.kinds } } : {}),
    ...(f?.labels?.length ? { labels: { hasSome: f.labels } } : {}),
    ...(f?.search ? { text: { contains: f.search, mode: 'insensitive' as const } } : {}),
    ...(f?.postExternalId ? { externalPostId: f.postExternalId } : {}),
  };
}

builder.queryFields(t => ({
  comments: t.prismaConnection({ type: 'Comment', cursor: 'id', authScopes: { user: true }, maxSize: 100, defaultSize: 50, args: { filter: t.arg({ type: CommentFilter }), sort: t.arg.string({ defaultValue: 'unanswered' }) }, resolve: async (q, _r, a, ctx) => ctx.db!.comment.findMany({ ...q, where: await where(ctx, a.filter), orderBy: a.sort === 'oldest' ? { externalCreatedAt: 'asc' } : a.sort === 'newest' ? { externalCreatedAt: 'desc' } : [{ repliedAt: { sort: 'asc', nulls: 'first' } }, { externalCreatedAt: 'desc' }] }) }),
  commentPostGroups: t.field({ type: [PostGroup], authScopes: { user: true }, args: { filter: t.arg({ type: CommentFilter }) }, resolve: async (_r, a, ctx) => {
    const w = await where(ctx, a.filter);
    const rows = await ctx.db!.comment.groupBy({ by: ['externalPostId', 'channelId'], where: { ...w, externalPostId: { not: null } }, _count: { _all: true }, _max: { externalCreatedAt: true } });
    const unanswered = await ctx.db!.comment.groupBy({ by: ['externalPostId', 'channelId'], where: { ...w, externalPostId: { not: null }, repliedAt: null }, _count: { _all: true } });
    const um = new Map(unanswered.map(u => [`${u.channelId}:${u.externalPostId}`, u._count._all]));
    return rows.map(r => ({ externalPostId: r.externalPostId!, channelId: r.channelId, count: r._count._all, unanswered: um.get(`${r.channelId}:${r.externalPostId}`) ?? 0, latestAt: r._max.externalCreatedAt! })).sort((a, b) => b.unanswered - a.unanswered || b.latestAt.getTime() - a.latestAt.getTime());
  } }),
  unansweredCount: t.int({ authScopes: { user: true }, resolve: async (_r, _a, ctx) => ctx.db!.comment.count({ where: await where(ctx, { unansweredOnly: true }) }) }),
}));

async function load(ctx: any, id: string, action: 'community.reply' | 'community.view') {
  const c = await ctx.db.comment.findFirstOrThrow({ where: { id, organizationId: ctx.tenant.organizationId }, include: { channel: true } });
  assertCan(ctx.tenant, action, c.channelId);
  return c;
}
async function credsFor(ch: any) { const connector = getConnector(ch.network); return { connector, creds: await tokenVault.forChannel(ch.id, ch, connector.refresh.bind(connector)) }; }

builder.mutationFields(t => ({
  replyToComment: t.prismaField({ type: 'Comment', authScopes: { user: true }, args: { id: t.arg.id({ required: true }), text: t.arg.string({ required: true }) }, resolve: async (q, _r, a, ctx) => {
    const c = await load(ctx, String(a.id), 'community.reply'); const { connector, creds } = await credsFor(c.channel);
    if (!connector.reply) throw new DomainError('VALIDATION', `${c.channel.displayName} does not support replies here`);
    const r = await connector.reply(creds, c.channel, { externalId: c.externalId, externalPostId: c.externalPostId ?? undefined, parentExternalId: c.parentExternalId ?? undefined, raw: c.raw }, a.text);
    await ctx.db!.comment.create({ data: { organizationId: c.organizationId, channelId: c.channelId, postTargetId: c.postTargetId, externalPostId: c.externalPostId, externalId: r.externalId, parentExternalId: c.externalId, kind: 'REPLY', authorName: c.channel.displayName, text: a.text, externalCreatedAt: new Date(), isOurs: true, raw: {} } }).catch(() => undefined);
    const updated = await ctx.db!.comment.update({ ...q, where: { id: c.id }, data: { repliedAt: new Date() } });
    events.publish(ctx.tenant!.organizationId, { type: 'comment.updated', commentId: c.id });
    return updated;
  } }),
  likeComment: t.boolean({ authScopes: { user: true }, args: { id: t.arg.id({ required: true }), reaction: t.arg.string() }, resolve: async (_r, a, ctx) => { const c = await load(ctx, String(a.id), 'community.reply'); const { connector, creds } = await credsFor(c.channel); if (!connector.like) throw new DomainError('VALIDATION', 'Not supported on this network'); await connector.like(creds, c.channel, { externalId: c.externalId, raw: c.raw }, a.reaction ?? undefined); return true; } }),
  hideComment: t.boolean({ authScopes: { user: true }, args: { id: t.arg.id({ required: true }), hidden: t.arg.boolean({ required: true }) }, resolve: async (_r, a, ctx) => { const c = await load(ctx, String(a.id), 'community.reply'); const { connector, creds } = await credsFor(c.channel); if (!connector.hide) throw new DomainError('VALIDATION', 'Not supported on this network'); await connector.hide(creds, c.channel, { externalId: c.externalId }, a.hidden); await ctx.db!.comment.update({ where: { id: c.id }, data: { isHidden: a.hidden } }); return true; } }),
  deleteComment: t.boolean({ authScopes: { user: true }, args: { id: t.arg.id({ required: true }) }, resolve: async (_r, a, ctx) => { const c = await load(ctx, String(a.id), 'community.reply'); const { connector, creds } = await credsFor(c.channel); if (!connector.deleteComment) throw new DomainError('VALIDATION', 'Not supported on this network'); await connector.deleteComment(creds, c.channel, { externalId: c.externalId, externalPostId: c.externalPostId ?? undefined }); await ctx.db!.comment.update({ where: { id: c.id }, data: { isDeleted: true, resolvedAt: new Date() } }); return true; } }),
  resolveComments: t.int({ authScopes: { user: true }, args: { ids: t.arg.idList(), all: t.arg.boolean(), olderThanDays: t.arg.int(), postExternalId: t.arg.string(), channelId: t.arg.id(), resolved: t.arg.boolean({ defaultValue: true }) }, resolve: async (_r, a, ctx) => {
    const allowed = visibleChannels(ctx, a.channelId ? [String(a.channelId)] : undefined);
    const w: any = { organizationId: ctx.tenant!.organizationId, ...(allowed ? { channelId: { in: allowed.filter(id => can(ctx.tenant!, 'community.reply', id)) } } : {}) };
    if (a.ids?.length) w.id = { in: a.ids.map(String) };
    else if (a.postExternalId) w.externalPostId = a.postExternalId;
    else if (a.olderThanDays) w.externalCreatedAt = { lt: new Date(Date.now() - a.olderThanDays * 864e5) };
    else if (!a.all) throw new DomainError('VALIDATION', 'Nothing selected');
    const r = await ctx.db!.comment.updateMany({ where: w, data: a.resolved ? { resolvedAt: new Date(), resolvedByAccountId: ctx.account!.id } : { resolvedAt: null, resolvedByAccountId: null } });
    return r.count;
  } }),
  syncInbox: t.boolean({ authScopes: { user: true }, args: { channelId: t.arg.id() }, resolve: async (_r, a, ctx) => { const chans = await ctx.db!.channel.findMany({ where: { organizationId: ctx.tenant!.organizationId, deletedAt: null, ...(a.channelId ? { id: String(a.channelId) } : {}) } }); for (const ch of chans) await queues.get('inbox').add('poll', { channelId: ch.id, organizationId: ch.organizationId }, { jobId: `inbox-manual-${ch.id}-${Math.floor(Date.now() / 60000)}` }); return true; } }),
}));
