import { builder } from '../builder.js';
import { PostStatusEnum, ScheduleModeEnum, SchedulingTypeEnum, Issue, AccountSummary } from './enums.js';
import { PostsService } from '../../posts/posts.service.js';
import { prismaAdmin } from '@relay/db';
import { fetchPreview } from '../../links/preview.service.js';
import { TagType } from './tags.js';

builder.prismaObject('Post', {
  fields: t => ({
    id: t.exposeID('id'),
    status: t.expose('status', { type: PostStatusEnum }),
    scheduleMode: t.expose('scheduleMode', { type: ScheduleModeEnum }),
    baseText: t.exposeString('baseText'),
    baseMedia: t.expose('baseMedia', { type: 'JSON' }),
    linkPreview: t.expose('linkPreview', { type: 'JSON', nullable: true }),
    aiAssisted: t.exposeBoolean('aiAssisted'),
    ideaId: t.exposeID('ideaId', { nullable: true }),
    createdBy: t.field({ type: AccountSummary, nullable: true, resolve: p => prismaAdmin.account.findUnique({ where: { id: p.createdByAccountId }, select: { id: true, email: true, name: true, avatarUrl: true } }) }),
    createdAt: t.expose('createdAt', { type: 'DateTime' }),
    updatedAt: t.expose('updatedAt', { type: 'DateTime' }),
    targets: t.relation('targets'),
    tags: t.field({ type: [TagType], resolve: async (p, _a, ctx) => (await ctx.db!.postTag.findMany({ where: { postId: p.id }, include: { tag: true } })).map(x => x.tag) }),
    approval: t.relation('approval', { nullable: true }),
    notes: t.relation('notes', { query: { where: { deletedAt: null }, orderBy: { createdAt: 'asc' } } }),
    notesCount: t.relationCount('notes', { where: { deletedAt: null } }),
  }),
});

builder.prismaObject('PostTarget', {
  fields: t => ({
    id: t.exposeID('id'),
    postId: t.exposeID('postId'),
    post: t.relation('post'),
    channel: t.relation('channel'),
    channelId: t.exposeID('channelId'),
    status: t.expose('status', { type: PostStatusEnum }),
    schedulingType: t.expose('schedulingType', { type: SchedulingTypeEnum }),
    isCustomTime: t.exposeBoolean('isCustomTime'),
    customized: t.exposeBoolean('customized'),
    dueAt: t.expose('dueAt', { type: 'DateTime', nullable: true }),
    queuePosition: t.exposeInt('queuePosition', { nullable: true }),
    text: t.exposeString('text'),
    media: t.expose('media', { type: 'JSON' }),
    thread: t.expose('thread', { type: 'JSON' }),
    firstComment: t.exposeString('firstComment', { nullable: true }),
    metadata: t.expose('metadata', { type: 'JSON' }),
    shortLinks: t.expose('shortLinks', { type: 'JSON' }),
    externalPostId: t.exposeString('externalPostId', { nullable: true }),
    externalUrl: t.exposeString('externalUrl', { nullable: true }),
    publishedAt: t.expose('publishedAt', { type: 'DateTime', nullable: true }),
    attemptCount: t.exposeInt('attemptCount'),
    failureCode: t.exposeString('failureCode', { nullable: true }),
    failureMessage: t.exposeString('failureMessage', { nullable: true }),
    metrics: t.field({ type: 'JSON', resolve: async (pt, _a, ctx) => { const rows = await ctx.db!.$queryRaw<{ metric: string; value: number }[]>`SELECT metric, value FROM post_metric_current WHERE "postTargetId" = ${pt.id}::uuid`; return Object.fromEntries(rows.map(r => [r.metric, Number(r.value)])); } }),
  }),
});
builder.prismaObject('Approval', { fields: t => ({ requestedByAccountId: t.exposeID('requestedByAccountId'), requestedAt: t.expose('requestedAt', { type: 'DateTime' }), decidedByAccountId: t.exposeID('decidedByAccountId', { nullable: true }), decidedAt: t.expose('decidedAt', { type: 'DateTime', nullable: true }), decision: t.exposeString('decision', { nullable: true }), reason: t.exposeString('reason', { nullable: true }) }) });
builder.prismaObject('Note', { fields: t => ({ id: t.exposeID('id'), body: t.exposeString('body'), author: t.field({ type: AccountSummary, nullable: true, resolve: n => prismaAdmin.account.findUnique({ where: { id: n.authorAccountId }, select: { id: true, email: true, name: true, avatarUrl: true } }) }), createdAt: t.expose('createdAt', { type: 'DateTime' }), editedAt: t.expose('editedAt', { type: 'DateTime', nullable: true }) }) });

const MediaInput = builder.inputType('MediaInput', { fields: t => ({ assetId: t.id({ required: true }), kind: t.string({ required: true }), altText: t.string(), userTags: t.field({ type: 'JSON' }), cover: t.field({ type: 'JSON' }), order: t.int() }) });
const ThreadPartInput = builder.inputType('ThreadPartInput', { fields: t => ({ text: t.string({ required: true }), media: t.field({ type: [MediaInput] }) }) });
const TargetInput = builder.inputType('TargetInput', { fields: t => ({ channelId: t.id({ required: true }), text: t.string(), media: t.field({ type: [MediaInput] }), thread: t.field({ type: [ThreadPartInput] }), firstComment: t.string(), metadata: t.field({ type: 'JSON' }), schedulingType: t.field({ type: SchedulingTypeEnum }) }) });
const LinkPreviewInput = builder.inputType('LinkPreviewInput', { fields: t => ({ url: t.string({ required: true }), title: t.string(), description: t.string(), imageAssetId: t.id() }) });
const CreatePostInput = builder.inputType('CreatePostInput', {
  fields: t => ({
    baseText: t.string({ required: true }), baseMedia: t.field({ type: [MediaInput] }), linkPreview: t.field({ type: LinkPreviewInput }),
    targets: t.field({ type: [TargetInput], required: true }), mode: t.field({ type: ScheduleModeEnum, required: true }), dueAt: t.field({ type: 'DateTime' }), dueAtByChannel: t.field({ type: 'JSON' }),
    tagIds: t.idList(), requestApproval: t.boolean(), ideaId: t.id(), templateId: t.id(), aiAssisted: t.boolean(),
  }),
});
const UpdatePostInput = builder.inputType('UpdatePostInput', { fields: t => ({ baseText: t.string(), baseMedia: t.field({ type: [MediaInput] }), linkPreview: t.field({ type: LinkPreviewInput }), targets: t.field({ type: [TargetInput] }), tagIds: t.idList(), mode: t.field({ type: ScheduleModeEnum }), dueAt: t.field({ type: 'DateTime' }) }) });

const PostFilter = builder.inputType('PostFilter', { fields: t => ({ status: t.field({ type: [PostStatusEnum] }), channelIds: t.idList(), tagIds: t.idList(), from: t.field({ type: 'DateTime' }), to: t.field({ type: 'DateTime' }), search: t.string(), createdByMe: t.boolean() }) });

const svc = (ctx: any) => new PostsService(ctx.db, ctx.tenant, ctx.account);
const toInput = (i: any) => ({ ...i, baseMedia: i.baseMedia ?? undefined, tagIds: i.tagIds?.map(String), targets: i.targets?.map((t: any) => ({ ...t, channelId: String(t.channelId), media: t.media ?? null, thread: t.thread ?? null })) });

const ValidationResult = builder.objectRef<{ channelId: string; issues: any[] }>('TargetValidation').implement({ fields: t => ({ channelId: t.exposeID('channelId'), issues: t.field({ type: [Issue], resolve: v => v.issues }) }) });
const LinkPreviewType = builder.objectRef<{ url: string; title?: string; description?: string; image?: string; siteName?: string }>('LinkPreview').implement({ fields: t => ({ url: t.exposeString('url'), title: t.exposeString('title', { nullable: true }), description: t.exposeString('description', { nullable: true }), image: t.exposeString('image', { nullable: true }), siteName: t.exposeString('siteName', { nullable: true }) }) });

builder.queryFields(t => ({
  post: t.prismaField({ type: 'Post', authScopes: { user: true }, args: { id: t.arg.id({ required: true }) }, resolve: (q, _r, args, ctx) => ctx.db!.post.findFirstOrThrow({ ...q, where: { id: String(args.id), organizationId: ctx.tenant!.organizationId, deletedAt: null } }) }),
  targets: t.prismaConnection({
    type: 'PostTarget', cursor: 'id', authScopes: { user: true, apiScope: 'posts:read' }, maxSize: 100, defaultSize: 50,
    args: { filter: t.arg({ type: PostFilter }) },
    resolve: (q, _r, args, ctx) => {
      const f = args.filter ?? {};
      const visible = ctx.tenant!.role !== 'MEMBER' ? undefined : Object.entries(ctx.tenant!.channelPermissions).filter(([, p]) => p.publish !== 'NONE').map(([id]) => id);
      return ctx.db!.postTarget.findMany({ ...q, where: {
        organizationId: ctx.tenant!.organizationId, post: { deletedAt: null, ...(f.createdByMe ? { createdByAccountId: ctx.account!.id } : {}), ...(f.tagIds?.length ? { tags: { some: { tagId: { in: f.tagIds.map(String) } } } } : {}) },
        ...(f.status?.length ? { status: { in: f.status } } : {}),
        channelId: f.channelIds?.length ? { in: f.channelIds.map(String).filter(id => !visible || visible.includes(id)) } : visible ? { in: visible } : undefined,
        ...(f.from || f.to ? { OR: [{ dueAt: { gte: f.from ?? undefined, lte: f.to ?? undefined } }, { publishedAt: { gte: f.from ?? undefined, lte: f.to ?? undefined } }] } : {}),
        ...(f.search ? { text: { contains: f.search, mode: 'insensitive' } } : {}),
      }, orderBy: f.status?.includes('PUBLISHED') ? { publishedAt: 'desc' } : [{ dueAt: 'asc' }, { queuePosition: 'asc' }, { createdAt: 'desc' }] });
    },
  }),
  validatePost: t.field({ type: [ValidationResult], authScopes: { user: true }, args: { input: t.arg({ type: CreatePostInput, required: true }) }, resolve: async (_r, args, ctx) => Object.entries(await svc(ctx).validate(toInput(args.input))).map(([channelId, issues]) => ({ channelId, issues })) }),
  linkPreview: t.field({ type: LinkPreviewType, authScopes: { user: true }, args: { url: t.arg.string({ required: true }) }, resolve: (_r, args) => fetchPreview(args.url) }),
}));

builder.mutationFields(t => ({
  createPost: t.prismaField({ type: 'Post', authScopes: { user: true, apiScope: 'posts:write' }, args: { input: t.arg({ type: CreatePostInput, required: true }) }, resolve: async (_q, _r, args, ctx) => svc(ctx).create(toInput(args.input)) as any }),
  updatePost: t.prismaField({ type: 'Post', authScopes: { user: true, apiScope: 'posts:write' }, args: { id: t.arg.id({ required: true }), input: t.arg({ type: UpdatePostInput, required: true }) }, resolve: async (_q, _r, args, ctx) => svc(ctx).update(String(args.id), toInput(args.input)) as any }),
  deletePost: t.boolean({ authScopes: { user: true, apiScope: 'posts:write' }, args: { id: t.arg.id({ required: true }) }, resolve: async (_r, args, ctx) => { await svc(ctx).delete(String(args.id)); return true; } }),
  duplicatePost: t.prismaField({ type: 'Post', authScopes: { user: true }, args: { id: t.arg.id({ required: true }), asDraft: t.arg.boolean({ defaultValue: true }) }, resolve: async (_q, _r, args, ctx) => svc(ctx).duplicate(String(args.id), args.asDraft ?? true) as any }),
  approvePost: t.boolean({ authScopes: { user: true }, args: { id: t.arg.id({ required: true }), mode: t.arg({ type: ScheduleModeEnum, defaultValue: 'QUEUE' }), dueAt: t.arg({ type: 'DateTime' }) }, resolve: async (_r, args, ctx) => { await svc(ctx).approve(String(args.id), { mode: (args.mode as any) ?? 'QUEUE', dueAt: args.dueAt }); return true; } }),
  rejectPost: t.boolean({ authScopes: { user: true }, args: { id: t.arg.id({ required: true }), reason: t.arg.string() }, resolve: async (_r, args, ctx) => { await svc(ctx).reject(String(args.id), args.reason ?? undefined); return true; } }),
  requestApproval: t.boolean({ authScopes: { user: true }, args: { id: t.arg.id({ required: true }) }, resolve: async (_r, args, ctx) => { await svc(ctx).requestApproval(String(args.id)); return true; } }),
  revertApproval: t.boolean({ authScopes: { user: true }, args: { id: t.arg.id({ required: true }) }, resolve: async (_r, args, ctx) => { await svc(ctx).revertApproval(String(args.id)); return true; } }),
  addNote: t.prismaField({ type: 'Note', authScopes: { user: true }, args: { postId: t.arg.id({ required: true }), body: t.arg.string({ required: true }) }, resolve: (q, _r, args, ctx) => ctx.db!.note.create({ ...q, data: { organizationId: ctx.tenant!.organizationId, postId: String(args.postId), authorAccountId: ctx.account!.id, body: args.body.slice(0, 5000) } }) }),
  editNote: t.prismaField({ type: 'Note', authScopes: { user: true }, args: { id: t.arg.id({ required: true }), body: t.arg.string({ required: true }) }, resolve: async (q, _r, args, ctx) => { const n = await ctx.db!.note.findUniqueOrThrow({ where: { id: String(args.id) } }); if (n.authorAccountId !== ctx.account!.id) throw new Error('Not authorized'); return ctx.db!.note.update({ ...q, where: { id: n.id }, data: { body: args.body.slice(0, 5000), editedAt: new Date() } }); } }),
  deleteNote: t.boolean({ authScopes: { user: true }, args: { id: t.arg.id({ required: true }) }, resolve: async (_r, args, ctx) => { const n = await ctx.db!.note.findUniqueOrThrow({ where: { id: String(args.id) } }); if (n.authorAccountId !== ctx.account!.id && ctx.tenant!.role === 'MEMBER') throw new Error('Not authorized'); await ctx.db!.note.update({ where: { id: n.id }, data: { deletedAt: new Date() } }); return true; } }),
}));
