import { builder } from '../builder.js';
import { prismaAdmin } from '@cadence/db';
import { DomainError } from '@cadence/domain';
import { env } from '@cadence/config';

builder.prismaObject('StartPage', {
  fields: t => ({
    id: t.exposeID('id'), slug: t.exposeString('slug'), nickname: t.exposeString('nickname'), theme: t.expose('theme', { type: 'JSON' }), header: t.expose('header', { type: 'JSON' }), blocks: t.expose('blocks', { type: 'JSON' }),
    publishedAt: t.expose('publishedAt', { type: 'DateTime', nullable: true }), isPublished: t.boolean({ resolve: p => !!p.publishedAt }),
    url: t.string({ resolve: p => `${env.APP_URL.replace('://', '://' + p.slug + '.start.')}` }),
    stats: t.field({ type: 'JSON', args: { days: t.arg.int({ defaultValue: 30 }) }, resolve: async (p, a, ctx) => {
      const rows = await ctx.db!.$queryRaw<{ event: string; block_id: string | null; n: number }[]>`SELECT event, block_id, count(*)::int AS n FROM start_page_events WHERE start_page_id = ${p.id}::uuid AND ts > now() - (${a.days ?? 30} || ' days')::interval GROUP BY 1,2`;
      const views = rows.filter(r => r.event === 'view').reduce((s, r) => s + r.n, 0); const clicks = rows.filter(r => r.event === 'click');
      return { views, clicks: clicks.reduce((s, r) => s + r.n, 0), ctr: views ? clicks.reduce((s, r) => s + r.n, 0) / views : 0, byBlock: Object.fromEntries(clicks.map(r => [r.block_id, r.n])) };
    } }),
  }),
});

const THEMES = ['sand', 'midnight', 'forest', 'ocean', 'sunset', 'lavender', 'mono', 'candy', 'slate', 'olive', 'coral', 'sky', 'paper', 'ink', 'mint', 'plum'];
const DEFAULT_THEME = { id: 'sand', background: { type: 'color', value: '#FCFBF9' }, button: { style: 'filled', radius: 'pill', color: '#6DB44F', textColor: '#0B1F0B' }, font: { heading: 'Inter', body: 'Inter' }, banner: 'none', text: '#1F1D1A' };

builder.queryFields(t => ({
  startPages: t.prismaField({ type: ['StartPage'], authScopes: { user: true }, resolve: (q, _r, _a, ctx) => ctx.db!.startPage.findMany({ ...q, where: { organizationId: ctx.tenant!.organizationId } }) }),
  startPageSlugAvailable: t.boolean({ authScopes: { user: true }, args: { slug: t.arg.string({ required: true }) }, resolve: async (_r, a) => /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])?$/.test(a.slug) && !(await prismaAdmin.startPage.findUnique({ where: { slug: a.slug } })) && !['www', 'api', 'app', 'admin', 'help', 'support', 'relay'].includes(a.slug) }),
  startPageThemes: t.stringList({ resolve: () => THEMES }),
}));

builder.mutationFields(t => ({
  createStartPage: t.prismaField({ type: 'StartPage', authScopes: { user: true }, args: { slug: t.arg.string({ required: true }), nickname: t.arg.string() }, resolve: async (q, _r, a, ctx) => {
    if (!/^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])?$/.test(a.slug)) throw new DomainError('VALIDATION', 'Use 3–40 lowercase letters, numbers or hyphens', 'slug');
    if (await prismaAdmin.startPage.findUnique({ where: { slug: a.slug } })) throw new DomainError('CONFLICT', 'That address is taken', 'slug');
    const org = await prismaAdmin.organization.findUniqueOrThrow({ where: { id: ctx.tenant!.organizationId } });
    const page = await ctx.db!.startPage.create({ ...q, data: { organizationId: ctx.tenant!.organizationId, slug: a.slug, nickname: a.nickname ?? org.name, theme: DEFAULT_THEME, header: { title: org.name, tagline: '', socialIcons: [] }, blocks: [{ id: 'b1', type: 'link', label: 'Our website', url: 'https://example.com' }, { id: 'b2', type: 'updates', count: 5, items: [] }] } });
    // Start Page is also a channel so posts can be scheduled to its Updates block
    await prismaAdmin.channel.create({ data: { organizationId: ctx.tenant!.organizationId, network: 'START_PAGE', subtype: 'page', externalId: page.id, displayName: `Start Page · ${a.slug}`, handle: a.slug, connectedByAccountId: ctx.account!.id, meta: { startPageId: page.id }, timezone: ctx.account!.timezone } });
    return page;
  } }),
  updateStartPage: t.prismaField({ type: 'StartPage', authScopes: { user: true }, args: { id: t.arg.id({ required: true }), nickname: t.arg.string(), theme: t.arg({ type: 'JSON' }), header: t.arg({ type: 'JSON' }), blocks: t.arg({ type: 'JSON' }) }, resolve: async (q, _r, a, ctx) => {
    const blocks = a.blocks as any[] | undefined;
    if (blocks) { if (blocks.length > 60) throw new DomainError('VALIDATION', 'Too many blocks'); for (const b of blocks) { if (b.type === 'imageGrid' && (b.items?.length ?? 0) > 18) throw new DomainError('VALIDATION', 'Image grids hold up to 18 images'); for (const k of ['url']) if (b[k] && !/^https?:\/\//.test(b[k])) throw new DomainError('VALIDATION', `Invalid link in ${b.type} block`); } }
    return ctx.db!.startPage.update({ ...q, where: { id: String(a.id) }, data: { ...(a.nickname ? { nickname: a.nickname } : {}), ...(a.theme ? { theme: a.theme as any } : {}), ...(a.header ? { header: a.header as any } : {}), ...(blocks ? { blocks: blocks as any } : {}) } });
  } }),
  publishStartPage: t.prismaField({ type: 'StartPage', authScopes: { user: true }, args: { id: t.arg.id({ required: true }), publish: t.arg.boolean({ required: true }) }, resolve: async (q, _r, a, ctx) => {
    if (a.publish && !ctx.account!.emailVerifiedAt && env.NODE_ENV === 'production') throw new DomainError('VALIDATION', 'Verify your email before publishing a Start Page');
    const p = await ctx.db!.startPage.findUniqueOrThrow({ where: { id: String(a.id) } });
    const updated = await ctx.db!.startPage.update({ ...q, where: { id: p.id }, data: a.publish ? { publishedRevision: { theme: p.theme, header: p.header, blocks: p.blocks, nickname: p.nickname } as any, publishedAt: new Date() } : { publishedAt: null } });
    await fetch(`${env.APP_URL.replace('://', '://' + p.slug + '.start.')}/api/revalidate?secret=${encodeURIComponent(env.SESSION_SECRET)}`, { method: 'POST' }).catch(() => undefined);
    return updated;
  } }),
  deleteStartPage: t.boolean({ authScopes: { admin: true }, args: { id: t.arg.id({ required: true }) }, resolve: async (_r, a, ctx) => { await ctx.db!.startPage.delete({ where: { id: String(a.id) } }); await prismaAdmin.channel.updateMany({ where: { network: 'START_PAGE', externalId: String(a.id) }, data: { deletedAt: new Date(), status: 'DISCONNECTED' } }); return true; } }),
}));
