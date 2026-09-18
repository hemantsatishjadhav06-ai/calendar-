import { builder } from '../builder.js';
import { entitlement } from '@relay/domain';
import { within } from '@relay/entitlements';

export const TagType = builder.prismaObject('Tag', { fields: t => ({ id: t.exposeID('id'), name: t.exposeString('name'), color: t.exposeString('color'), postCount: t.relationCount('posts') }) });
builder.prismaObject('HashtagGroup', { fields: t => ({ id: t.exposeID('id'), name: t.exposeString('name'), hashtags: t.exposeStringList('hashtags') }) });
builder.prismaObject('SavedReply', { fields: t => ({ id: t.exposeID('id'), title: t.exposeString('title'), body: t.exposeString('body') }) });

builder.queryFields(t => ({
  tags: t.prismaField({ type: ['Tag'], authScopes: { user: true }, resolve: (q, _r, _a, ctx) => ctx.db!.tag.findMany({ ...q, where: { organizationId: ctx.tenant!.organizationId }, orderBy: { name: 'asc' } }) }),
  hashtagGroups: t.prismaField({ type: ['HashtagGroup'], authScopes: { user: true }, resolve: (q, _r, _a, ctx) => ctx.db!.hashtagGroup.findMany({ ...q, where: { organizationId: ctx.tenant!.organizationId }, orderBy: { name: 'asc' } }) }),
  savedReplies: t.prismaField({ type: ['SavedReply'], authScopes: { user: true }, resolve: (q, _r, _a, ctx) => ctx.db!.savedReply.findMany({ ...q, where: { organizationId: ctx.tenant!.organizationId }, orderBy: { title: 'asc' } }) }),
}));

builder.mutationFields(t => ({
  createTag: t.prismaField({ type: 'Tag', authScopes: { user: true }, args: { name: t.arg.string({ required: true }), color: t.arg.string({ required: true }) }, resolve: async (q, _r, a, ctx) => { const n = await ctx.db!.tag.count({ where: { organizationId: ctx.tenant!.organizationId } }); if (n >= ctx.tenant!.entitlements.tags) throw entitlement(`Your plan allows ${ctx.tenant!.entitlements.tags} tags`, 'tags'); return ctx.db!.tag.create({ ...q, data: { organizationId: ctx.tenant!.organizationId, name: a.name.trim().slice(0, 40), color: a.color } }); } }),
  updateTag: t.prismaField({ type: 'Tag', authScopes: { user: true }, args: { id: t.arg.id({ required: true }), name: t.arg.string(), color: t.arg.string() }, resolve: (q, _r, a, ctx) => ctx.db!.tag.update({ ...q, where: { id: String(a.id) }, data: { ...(a.name ? { name: a.name.trim().slice(0, 40) } : {}), ...(a.color ? { color: a.color } : {}) } }) }),
  deleteTag: t.boolean({ authScopes: { user: true }, args: { id: t.arg.id({ required: true }) }, resolve: async (_r, a, ctx) => { await ctx.db!.tag.delete({ where: { id: String(a.id) } }); return true; } }),
  saveHashtagGroup: t.prismaField({ type: 'HashtagGroup', authScopes: { user: true }, args: { id: t.arg.id(), name: t.arg.string({ required: true }), hashtags: t.arg.stringList({ required: true }) }, resolve: async (q, _r, a, ctx) => {
    if (!ctx.tenant!.entitlements.hashtagManager) throw entitlement('Hashtag manager is available on paid plans', 'hashtagManager');
    const tags = a.hashtags.map(h => h.trim().replace(/^#/, '')).filter(Boolean).map(h => `#${h}`);
    return a.id ? ctx.db!.hashtagGroup.update({ ...q, where: { id: String(a.id) }, data: { name: a.name, hashtags: tags } }) : ctx.db!.hashtagGroup.create({ ...q, data: { organizationId: ctx.tenant!.organizationId, name: a.name, hashtags: tags } });
  } }),
  deleteHashtagGroup: t.boolean({ authScopes: { user: true }, args: { id: t.arg.id({ required: true }) }, resolve: async (_r, a, ctx) => { await ctx.db!.hashtagGroup.delete({ where: { id: String(a.id) } }); return true; } }),
  saveSavedReply: t.prismaField({ type: 'SavedReply', authScopes: { user: true }, args: { id: t.arg.id(), title: t.arg.string({ required: true }), body: t.arg.string({ required: true }) }, resolve: async (q, _r, a, ctx) => {
    if (!a.id) { const n = await ctx.db!.savedReply.count({ where: { organizationId: ctx.tenant!.organizationId } }); if (!within(ctx.tenant!.entitlements.savedReplies, n)) throw entitlement(`Your plan allows ${ctx.tenant!.entitlements.savedReplies} saved replies`, 'savedReplies'); }
    const data = { title: a.title.slice(0, 80), body: a.body.slice(0, 1000) };
    return a.id ? ctx.db!.savedReply.update({ ...q, where: { id: String(a.id) }, data }) : ctx.db!.savedReply.create({ ...q, data: { organizationId: ctx.tenant!.organizationId, ...data } });
  } }),
  deleteSavedReply: t.boolean({ authScopes: { user: true }, args: { id: t.arg.id({ required: true }) }, resolve: async (_r, a, ctx) => { await ctx.db!.savedReply.delete({ where: { id: String(a.id) } }); return true; } }),
}));
