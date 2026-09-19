import { builder } from '../builder.js';
import { AccountSummary } from './enums.js';
import { prismaAdmin } from '@cadence/db';
import { within } from '@cadence/entitlements';
import { entitlement } from '@cadence/domain';
import { TagType } from './tags.js';

builder.prismaObject('Idea', {
  fields: t => ({
    id: t.exposeID('id'), title: t.exposeString('title', { nullable: true }), body: t.exposeString('body'), media: t.expose('media', { type: 'JSON' }), links: t.expose('links', { type: 'JSON' }),
    groupId: t.exposeID('groupId', { nullable: true }), sortOrder: t.exposeInt('sortOrder'), aiGenerated: t.exposeBoolean('aiGenerated'), usedAt: t.expose('usedAt', { type: 'DateTime', nullable: true }),
    tags: t.field({ type: [TagType], resolve: async (i, _a, ctx) => (await ctx.db!.ideaTag.findMany({ where: { ideaId: i.id }, include: { tag: true } })).map(x => x.tag) }),
    createdBy: t.field({ type: AccountSummary, nullable: true, resolve: i => prismaAdmin.account.findUnique({ where: { id: i.createdByAccountId }, select: { id: true, email: true, name: true, avatarUrl: true } }) }),
    createdAt: t.expose('createdAt', { type: 'DateTime' }), updatedAt: t.expose('updatedAt', { type: 'DateTime' }),
  }),
});
builder.prismaObject('IdeaGroup', { fields: t => ({ id: t.exposeID('id'), name: t.exposeString('name'), sortOrder: t.exposeInt('sortOrder'), ideas: t.relation('ideas', { query: { where: { deletedAt: null }, orderBy: { sortOrder: 'asc' } } }) }) });
builder.prismaObject('Template', { fields: t => ({ id: t.exposeID('id'), title: t.exposeString('title'), body: t.exposeString('body'), category: t.exposeString('category', { nullable: true }), isLibrary: t.exposeBoolean('isLibrary'), ownerAccountId: t.exposeID('ownerAccountId', { nullable: true }) }) });

const IdeaInput = builder.inputType('IdeaInput', { fields: t => ({ title: t.string(), body: t.string(), media: t.field({ type: 'JSON' }), links: t.field({ type: 'JSON' }), groupId: t.id(), tagIds: t.idList(), aiGenerated: t.boolean() }) });

builder.queryFields(t => ({
  ideaGroups: t.prismaField({ type: ['IdeaGroup'], authScopes: { user: true }, resolve: (q, _r, _a, ctx) => ctx.db!.ideaGroup.findMany({ ...q, where: { organizationId: ctx.tenant!.organizationId }, orderBy: { sortOrder: 'asc' } }) }),
  ideas: t.prismaConnection({ type: 'Idea', cursor: 'id', authScopes: { user: true, apiScope: 'ideas:read' }, args: { groupId: t.arg.id(), tagId: t.arg.id(), search: t.arg.string() }, resolve: (q, _r, a, ctx) => ctx.db!.idea.findMany({ ...q, where: { organizationId: ctx.tenant!.organizationId, deletedAt: null, ...(a.groupId ? { groupId: String(a.groupId) } : {}), ...(a.tagId ? { tags: { some: { tagId: String(a.tagId) } } } : {}), ...(a.search ? { OR: [{ body: { contains: a.search, mode: 'insensitive' } }, { title: { contains: a.search, mode: 'insensitive' } }] } : {}) }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }] }) }),
  templates: t.prismaField({ type: ['Template'], authScopes: { user: true }, args: { category: t.arg.string() }, resolve: (q, _r, a, ctx) => prismaAdmin.template.findMany({ ...q, where: { OR: [{ isLibrary: true }, { organizationId: ctx.tenant!.organizationId }], ...(a.category ? { category: a.category } : {}) }, orderBy: [{ isLibrary: 'asc' }, { title: 'asc' }] }) }),
}));

builder.mutationFields(t => ({
  createIdea: t.prismaField({ type: 'Idea', authScopes: { user: true, apiScope: 'ideas:write' }, args: { input: t.arg({ type: IdeaInput, required: true }) }, resolve: async (q, _r, a, ctx) => {
    const n = await ctx.db!.idea.count({ where: { organizationId: ctx.tenant!.organizationId, deletedAt: null } });
    if (!within(ctx.tenant!.entitlements.ideas, n)) throw entitlement(`Your plan allows ${ctx.tenant!.entitlements.ideas} ideas`, 'ideas');
    const i = a.input;
    return ctx.db!.idea.create({ ...q, data: { organizationId: ctx.tenant!.organizationId, createdByAccountId: ctx.account!.id, title: i.title ?? undefined, body: i.body ?? '', media: (i.media as any) ?? [], links: (i.links as any) ?? [], groupId: i.groupId ? String(i.groupId) : undefined, aiGenerated: !!i.aiGenerated, tags: { create: (i.tagIds ?? []).map(tagId => ({ tagId: String(tagId) })) } } });
  } }),
  updateIdea: t.prismaField({ type: 'Idea', authScopes: { user: true, apiScope: 'ideas:write' }, args: { id: t.arg.id({ required: true }), input: t.arg({ type: IdeaInput, required: true }) }, resolve: (q, _r, a, ctx) => { const i = a.input; return ctx.db!.idea.update({ ...q, where: { id: String(a.id) }, data: { ...(i.title !== undefined ? { title: i.title } : {}), ...(i.body != null ? { body: i.body } : {}), ...(i.media ? { media: i.media as any } : {}), ...(i.links ? { links: i.links as any } : {}), ...(i.groupId !== undefined ? { groupId: i.groupId ? String(i.groupId) : null } : {}), ...(i.tagIds ? { tags: { deleteMany: {}, create: i.tagIds.map(tagId => ({ tagId: String(tagId) })) } } : {}) } }); } }),
  moveIdea: t.boolean({ authScopes: { user: true }, args: { id: t.arg.id({ required: true }), groupId: t.arg.id(), sortOrder: t.arg.int({ required: true }) }, resolve: async (_r, a, ctx) => { await ctx.db!.idea.update({ where: { id: String(a.id) }, data: { groupId: a.groupId ? String(a.groupId) : null, sortOrder: a.sortOrder } }); return true; } }),
  deleteIdea: t.boolean({ authScopes: { user: true, apiScope: 'ideas:write' }, args: { id: t.arg.id({ required: true }) }, resolve: async (_r, a, ctx) => { await ctx.db!.idea.update({ where: { id: String(a.id) }, data: { deletedAt: new Date() } }); return true; } }),
  createIdeaGroup: t.prismaField({ type: 'IdeaGroup', authScopes: { user: true }, args: { name: t.arg.string({ required: true }) }, resolve: async (q, _r, a, ctx) => { const n = await ctx.db!.ideaGroup.count({ where: { organizationId: ctx.tenant!.organizationId } }); if (n >= ctx.tenant!.entitlements.ideaGroups) throw entitlement(`Your plan allows ${ctx.tenant!.entitlements.ideaGroups} idea groups`, 'ideaGroups'); return ctx.db!.ideaGroup.create({ ...q, data: { organizationId: ctx.tenant!.organizationId, name: a.name, sortOrder: n } }); } }),
  renameIdeaGroup: t.prismaField({ type: 'IdeaGroup', authScopes: { user: true }, args: { id: t.arg.id({ required: true }), name: t.arg.string({ required: true }) }, resolve: (q, _r, a, ctx) => ctx.db!.ideaGroup.update({ ...q, where: { id: String(a.id) }, data: { name: a.name } }) }),
  deleteIdeaGroup: t.boolean({ authScopes: { user: true }, args: { id: t.arg.id({ required: true }) }, resolve: async (_r, a, ctx) => { await ctx.db!.idea.updateMany({ where: { groupId: String(a.id) }, data: { groupId: null } }); await ctx.db!.ideaGroup.delete({ where: { id: String(a.id) } }); return true; } }),
  createTemplate: t.prismaField({ type: 'Template', authScopes: { user: true }, args: { title: t.arg.string({ required: true }), body: t.arg.string({ required: true }), category: t.arg.string(), personal: t.arg.boolean() }, resolve: (q, _r, a, ctx) => ctx.db!.template.create({ ...q, data: { organizationId: ctx.tenant!.organizationId, ownerAccountId: a.personal ? ctx.account!.id : null, title: a.title, body: a.body, category: a.category ?? undefined } }) }),
  deleteTemplate: t.boolean({ authScopes: { user: true }, args: { id: t.arg.id({ required: true }) }, resolve: async (_r, a, ctx) => { await ctx.db!.template.deleteMany({ where: { id: String(a.id), organizationId: ctx.tenant!.organizationId } }); return true; } }),
}));
