import { builder } from '../builder.js';
import { prismaAdmin } from '@cadence/db';
import { entitlement, DomainError } from '@cadence/domain';
import { AuthService } from '../../auth/auth.service.js';

const auth = new AuthService();

builder.prismaObject('ApiKey', { fields: t => ({ id: t.exposeID('id'), name: t.exposeString('name'), prefix: t.exposeString('prefix'), scopes: t.exposeStringList('scopes'), lastUsedAt: t.expose('lastUsedAt', { type: 'DateTime', nullable: true }), createdAt: t.expose('createdAt', { type: 'DateTime' }), revokedAt: t.expose('revokedAt', { type: 'DateTime', nullable: true }) }) });
builder.prismaObject('SavedView', { fields: t => ({ id: t.exposeID('id'), area: t.exposeString('area'), name: t.exposeString('name'), filters: t.expose('filters', { type: 'JSON' }), sortOrder: t.exposeInt('sortOrder') }) });
builder.prismaObject('AuditLog', { fields: t => ({ id: t.field({ type: 'ID', resolve: a => String(a.id) }), action: t.exposeString('action'), entity: t.exposeString('entity'), entityId: t.exposeString('entityId', { nullable: true }), actorAccountId: t.exposeID('actorAccountId', { nullable: true }), diff: t.expose('diff', { type: 'JSON', nullable: true }), createdAt: t.expose('createdAt', { type: 'DateTime' }) }) });

const PrefsInput = builder.inputType('PreferencesInput', { fields: t => ({ name: t.string(), timezone: t.string(), weekStartsOn: t.int(), appearance: t.string(), landingPage: t.string(), defaultScheduleAction: t.string(), avatarUrl: t.string() }) });
const NewApiKey = builder.objectRef<{ key: string; id: string }>('NewApiKey').implement({ fields: t => ({ key: t.exposeString('key'), id: t.exposeID('id') }) });

builder.queryFields(t => ({
  apiKeys: t.prismaField({ type: ['ApiKey'], authScopes: { user: true }, resolve: (q, _r, _a, ctx) => ctx.db!.apiKey.findMany({ ...q, where: { organizationId: ctx.tenant!.organizationId, accountId: ctx.account!.id, revokedAt: null } }) }),
  savedViews: t.prismaField({ type: ['SavedView'], authScopes: { user: true }, args: { area: t.arg.string() }, resolve: (q, _r, a, ctx) => ctx.db!.savedView.findMany({ ...q, where: { organizationId: ctx.tenant!.organizationId, accountId: ctx.account!.id, ...(a.area ? { area: a.area } : {}) }, orderBy: { sortOrder: 'asc' } }) }),
  notificationPrefs: t.field({ type: 'JSON', authScopes: { user: true }, resolve: async (_r, _a, ctx) => Object.fromEntries((await prismaAdmin.notificationPref.findMany({ where: { accountId: ctx.account!.id } })).map(p => [p.key, p.enabled])) }),
  auditLog: t.prismaField({ type: ['AuditLog'], authScopes: { admin: true }, args: { take: t.arg.int({ defaultValue: 100 }), before: t.arg({ type: 'DateTime' }) }, resolve: (q, _r, a, ctx) => ctx.db!.auditLog.findMany({ ...q, where: { organizationId: ctx.tenant!.organizationId, ...(a.before ? { createdAt: { lt: a.before } } : {}) }, orderBy: { createdAt: 'desc' }, take: Math.min(500, a.take ?? 100) }) }),
}));

builder.mutationFields(t => ({
  updatePreferences: t.boolean({ authScopes: { user: true }, args: { input: t.arg({ type: PrefsInput, required: true }) }, resolve: async (_r, a, ctx) => {
    const i = a.input;
    if (i.weekStartsOn != null && ![0, 1].includes(i.weekStartsOn)) throw new DomainError('VALIDATION', 'weekStartsOn must be 0 or 1');
    await prismaAdmin.account.update({ where: { id: ctx.account!.id }, data: { ...(i.name !== undefined ? { name: i.name } : {}), ...(i.timezone ? { timezone: i.timezone } : {}), ...(i.weekStartsOn != null ? { weekStartsOn: i.weekStartsOn } : {}), ...(i.appearance ? { appearance: i.appearance } : {}), ...(i.landingPage ? { landingPage: i.landingPage } : {}), ...(i.defaultScheduleAction ? { defaultScheduleAction: i.defaultScheduleAction } : {}), ...(i.avatarUrl !== undefined ? { avatarUrl: i.avatarUrl } : {}) } });
    return true;
  } }),
  setNotificationPref: t.boolean({ authScopes: { user: true }, args: { key: t.arg.string({ required: true }), enabled: t.arg.boolean({ required: true }) }, resolve: async (_r, a, ctx) => { await prismaAdmin.notificationPref.upsert({ where: { accountId_key: { accountId: ctx.account!.id, key: a.key } }, create: { accountId: ctx.account!.id, key: a.key, enabled: a.enabled }, update: { enabled: a.enabled } }); return true; } }),
  createApiKey: t.field({ type: NewApiKey, authScopes: { user: true }, args: { name: t.arg.string({ required: true }), scopes: t.arg.stringList({ required: true }) }, resolve: async (_r, a, ctx) => {
    const n = await ctx.db!.apiKey.count({ where: { organizationId: ctx.tenant!.organizationId, revokedAt: null } });
    if (n >= ctx.tenant!.entitlements.apiKeys) throw entitlement(`Your plan allows ${ctx.tenant!.entitlements.apiKeys} API keys`, 'apiKeys');
    const allowed = ['posts:read', 'posts:write', 'ideas:read', 'ideas:write', 'account:read', 'account:write'];
    const key = await auth.createApiKey(ctx.account!.id, ctx.tenant!.organizationId, a.name.slice(0, 60), a.scopes.filter(s => allowed.includes(s)));
    const row = await ctx.db!.apiKey.findFirstOrThrow({ where: { prefix: key.slice(0, 16) } });
    await prismaAdmin.auditLog.create({ data: { organizationId: ctx.tenant!.organizationId, actorAccountId: ctx.account!.id, action: 'apikey.create', entity: 'ApiKey', entityId: row.id } });
    return { key, id: row.id };
  } }),
  revokeApiKey: t.boolean({ authScopes: { user: true }, args: { id: t.arg.id({ required: true }) }, resolve: async (_r, a, ctx) => { await ctx.db!.apiKey.updateMany({ where: { id: String(a.id), accountId: ctx.account!.id }, data: { revokedAt: new Date() } }); return true; } }),
  saveView: t.prismaField({ type: 'SavedView', authScopes: { user: true }, args: { id: t.arg.id(), area: t.arg.string({ required: true }), name: t.arg.string({ required: true }), filters: t.arg({ type: 'JSON', required: true }) }, resolve: (q, _r, a, ctx) => a.id ? ctx.db!.savedView.update({ ...q, where: { id: String(a.id) }, data: { name: a.name, filters: a.filters as any } }) : ctx.db!.savedView.create({ ...q, data: { organizationId: ctx.tenant!.organizationId, accountId: ctx.account!.id, area: a.area, name: a.name.slice(0, 60), filters: a.filters as any } }) }),
  deleteView: t.boolean({ authScopes: { user: true }, args: { id: t.arg.id({ required: true }) }, resolve: async (_r, a, ctx) => { await ctx.db!.savedView.deleteMany({ where: { id: String(a.id), accountId: ctx.account!.id } }); return true; } }),
}));
