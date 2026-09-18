import { builder } from '../builder.js';
import { Prisma } from '@cadence/db';
import { DomainError, entitlement } from '@cadence/domain';

const LAST = new Set(['followers', 'monthly_views', 'posts_total', 'likes_total']);

const MetricDelta = builder.objectRef<{ metric: string; current: number | null; previous: number | null; change: number | null }>('MetricDelta').implement({ fields: t => ({ metric: t.exposeString('metric'), current: t.exposeFloat('current', { nullable: true }), previous: t.exposeFloat('previous', { nullable: true }), change: t.exposeFloat('change', { nullable: true }) }) });
const SeriesPoint = builder.objectRef<{ day: string; metric: string; value: number }>('SeriesPoint').implement({ fields: t => ({ day: t.exposeString('day'), metric: t.exposeString('metric'), value: t.exposeFloat('value') }) });
const AudienceRow = builder.objectRef<{ dimension: string; bucket: string; value: number }>('AudienceRow').implement({ fields: t => ({ dimension: t.exposeString('dimension'), bucket: t.exposeString('bucket'), value: t.exposeFloat('value') }) });
const HashtagPerf = builder.objectRef<{ hashtag: string; posts: number; engagements: number; impressions: number }>('HashtagPerformance').implement({ fields: t => ({ hashtag: t.exposeString('hashtag'), posts: t.exposeInt('posts'), engagements: t.exposeFloat('engagements'), impressions: t.exposeFloat('impressions') }) });

const RangeInput = builder.inputType('InsightsRange', { fields: t => ({ channelIds: t.idList(), from: t.field({ type: 'DateTime', required: true }), to: t.field({ type: 'DateTime', required: true }), compareFrom: t.field({ type: 'DateTime' }), compareTo: t.field({ type: 'DateTime' }), tagId: t.id() }) });

function guard(ctx: any, r: any) {
  const ent = ctx.tenant.entitlements;
  const days = (Date.now() - r.from.getTime()) / 864e5;
  if (ent.analyticsHistoryDays !== 'unlimited' && days > ent.analyticsHistoryDays + 1) throw entitlement(`Your plan includes ${ent.analyticsHistoryDays} days of history`, 'analyticsHistory');
  if ((r.compareFrom || r.compareTo) && !ent.comparisons) throw entitlement('Comparisons are available on paid plans', 'comparisons');
  if (r.to.getTime() - r.from.getTime() > 400 * 864e5) throw new DomainError('VALIDATION', 'Range too large (max 400 days)');
}
function channels(ctx: any, ids?: string[]) {
  const visible = ctx.tenant.role !== 'MEMBER' ? null : Object.entries(ctx.tenant.channelPermissions as Record<string, any>).filter(([, p]) => p.publish !== 'NONE' || p.community !== 'NONE').map(([id]) => id);
  const req = ids?.map(String);
  return req?.length ? req.filter(id => !visible || visible.includes(id)) : visible;
}

builder.queryFields(t => ({
  insightsSummary: t.field({ type: [MetricDelta], authScopes: { user: true }, args: { range: t.arg({ type: RangeInput, required: true }) }, resolve: async (_r, a, ctx) => {
    const r = a.range; guard(ctx, r);
    const ids = channels(ctx, r.channelIds as any);
    const idFilter = ids ? Prisma.sql`AND c.id = ANY(${ids}::uuid[])` : Prisma.empty;
    const org = ctx.tenant!.organizationId;
    const agg = async (from: Date, to: Date) => {
      const chan = await ctx.db!.$queryRaw<{ metric: string; v: number }[]>(Prisma.sql`SELECT m.metric, CASE WHEN m.metric IN ('followers','monthly_views','posts_total','likes_total') THEN last(m.value, m.day) ELSE sum(m.value) END AS v FROM "ChannelMetricDaily" m JOIN "Channel" c ON c.id = m."channelId" WHERE c."organizationId" = ${org}::uuid ${idFilter} AND m.day BETWEEN ${from}::date AND ${to}::date GROUP BY m.metric`);
      const posts = await ctx.db!.$queryRaw<{ metric: string; v: number }[]>(Prisma.sql`SELECT pm.metric, sum(pm.value) AS v FROM post_metric_current pm JOIN "PostTarget" t ON t.id = pm."postTargetId" JOIN "Channel" c ON c.id = t."channelId" WHERE t."organizationId" = ${org}::uuid ${idFilter} AND t.status = 'PUBLISHED' AND t."publishedAt" BETWEEN ${from} AND ${to} ${r.tagId ? Prisma.sql`AND EXISTS (SELECT 1 FROM "PostTag" pt WHERE pt."postId" = t."postId" AND pt."tagId" = ${String(r.tagId)}::uuid)` : Prisma.empty} GROUP BY pm.metric`);
      const count = await ctx.db!.postTarget.count({ where: { organizationId: org, status: 'PUBLISHED', publishedAt: { gte: from, lte: to }, ...(ids ? { channelId: { in: ids } } : {}), ...(r.tagId ? { post: { tags: { some: { tagId: String(r.tagId) } } } } : {}) } });
      const m: Record<string, number> = {};
      for (const row of chan) if (LAST.has(row.metric) || row.metric === 'follows' || row.metric === 'unfollows' || row.metric === 'profile_views') m[row.metric] = Number(row.v);
      for (const row of posts) m[row.metric] = (m[row.metric] ?? 0) + Number(row.v);           // post-level engagement is the source of truth for interactions
      for (const row of chan) if (!(row.metric in m) && !LAST.has(row.metric)) m[row.metric] = Number(row.v);   // fall back to channel-level (e.g. impressions, reach)
      m.posts_published = count;
      m.engagements = (m.likes ?? 0) + (m.comments ?? 0) + (m.shares ?? 0) + (m.saves ?? 0) + (m.clicks ?? 0);
      m.engagement_rate = m.impressions ? m.engagements / m.impressions : m.followers ? m.engagements / m.followers : 0;
      return m;
    };
    const cur = await agg(r.from, r.to);
    const prev = r.compareFrom && r.compareTo ? await agg(r.compareFrom, r.compareTo) : null;
    const keys = ['posts_published', 'likes', 'comments', 'impressions', 'shares', 'saves', 'follows', 'reach', 'engagement_rate', 'engagements', 'followers', 'video_views', 'link_clicks', 'clicks', 'profile_views'];
    return keys.map(metric => { const c = cur[metric] ?? null, p = prev ? prev[metric] ?? null : null; return { metric, current: c, previous: p, change: c != null && p != null && p !== 0 ? (c - p) / p : null }; });
  } }),
  insightsSeries: t.field({ type: [SeriesPoint], authScopes: { user: true }, args: { range: t.arg({ type: RangeInput, required: true }), metrics: t.arg.stringList({ required: true }), bucket: t.arg.string({ defaultValue: 'day' }) }, resolve: async (_r, a, ctx) => {
    const r = a.range; guard(ctx, r); const ids = channels(ctx, r.channelIds as any);
    const idFilter = ids ? Prisma.sql`AND c.id = ANY(${ids}::uuid[])` : Prisma.empty;
    const bucket = a.bucket === 'week' ? '1 week' : '1 day';
    const chan = await ctx.db!.$queryRaw<{ day: Date; metric: string; value: number }[]>(Prisma.sql`SELECT time_bucket(${bucket}::interval, m.day::timestamptz) AS day, m.metric, CASE WHEN m.metric IN ('followers') THEN last(m.value, m.day) ELSE sum(m.value) END AS value FROM "ChannelMetricDaily" m JOIN "Channel" c ON c.id = m."channelId" WHERE c."organizationId" = ${ctx.tenant!.organizationId}::uuid ${idFilter} AND m.metric = ANY(${a.metrics}) AND m.day BETWEEN ${r.from}::date AND ${r.to}::date GROUP BY 1,2 ORDER BY 1`);
    const posts = a.metrics.includes('posts_published') ? await ctx.db!.$queryRaw<{ day: Date; value: number }[]>(Prisma.sql`SELECT time_bucket(${bucket}::interval, t."publishedAt") AS day, count(*)::float AS value FROM "PostTarget" t JOIN "Channel" c ON c.id = t."channelId" WHERE t."organizationId" = ${ctx.tenant!.organizationId}::uuid ${idFilter} AND t.status = 'PUBLISHED' AND t."publishedAt" BETWEEN ${r.from} AND ${r.to} GROUP BY 1 ORDER BY 1`) : [];
    return [...chan.map(x => ({ day: x.day.toISOString().slice(0, 10), metric: x.metric, value: Number(x.value) })), ...posts.map(x => ({ day: x.day.toISOString().slice(0, 10), metric: 'posts_published', value: Number(x.value) }))];
  } }),
  insightsPosts: t.prismaConnection({ type: 'PostTarget', cursor: 'id', authScopes: { user: true }, maxSize: 100, defaultSize: 25, args: { range: t.arg({ type: RangeInput, required: true }), sortBy: t.arg.string({ defaultValue: 'engagements' }) }, resolve: async (q, _r, a, ctx) => {
    const r = a.range; guard(ctx, r); const ids = channels(ctx, r.channelIds as any);
    const idFilter = ids ? Prisma.sql`AND t."channelId" = ANY(${ids}::uuid[])` : Prisma.empty;
    const sortMetric = ['engagements', 'impressions', 'likes', 'comments', 'shares', 'saves', 'video_views', 'link_clicks'].includes(a.sortBy ?? '') ? a.sortBy! : 'engagements';
    const rows = await ctx.db!.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT t.id FROM "PostTarget" t LEFT JOIN LATERAL (SELECT coalesce(sum(CASE WHEN ${sortMetric} = 'engagements' THEN CASE WHEN pm.metric IN ('likes','comments','shares','saves','clicks') THEN pm.value ELSE 0 END ELSE CASE WHEN pm.metric = ${sortMetric} THEN pm.value ELSE 0 END END), 0) AS score FROM post_metric_current pm WHERE pm."postTargetId" = t.id) s ON true WHERE t."organizationId" = ${ctx.tenant!.organizationId}::uuid ${idFilter} AND t.status = 'PUBLISHED' AND t."publishedAt" BETWEEN ${r.from} AND ${r.to} ${r.tagId ? Prisma.sql`AND EXISTS (SELECT 1 FROM "PostTag" pt WHERE pt."postId" = t."postId" AND pt."tagId" = ${String(r.tagId)}::uuid)` : Prisma.empty} ORDER BY s.score DESC, t."publishedAt" DESC LIMIT 500`);
    const order = new Map(rows.map((x, i) => [x.id, i]));
    const items = await ctx.db!.postTarget.findMany({ ...q, where: { id: { in: rows.map(x => x.id) } } });
    return items.sort((x, y) => (order.get(x.id) ?? 0) - (order.get(y.id) ?? 0));
  } }),
  insightsAudience: t.field({ type: [AudienceRow], authScopes: { user: true }, args: { channelId: t.arg.id({ required: true }) }, resolve: async (_r, a, ctx) => { const rows = await ctx.db!.audienceSnapshot.findMany({ where: { channelId: String(a.channelId) }, orderBy: { day: 'desc' }, take: 400 }); const latest = rows[0]?.day; return rows.filter(r => r.day.getTime() === latest?.getTime()).map(r => ({ dimension: r.dimension, bucket: r.bucket, value: r.value })); } }),
  insightsHashtags: t.field({ type: [HashtagPerf], authScopes: { user: true }, args: { range: t.arg({ type: RangeInput, required: true }), limit: t.arg.int({ defaultValue: 10 }) }, resolve: async (_r, a, ctx) => {
    const r = a.range; guard(ctx, r); const ids = channels(ctx, r.channelIds as any);
    const idFilter = ids ? Prisma.sql`AND t."channelId" = ANY(${ids}::uuid[])` : Prisma.empty;
    const rows = await ctx.db!.$queryRaw<{ hashtag: string; posts: number; engagements: number; impressions: number }[]>(Prisma.sql`SELECT h AS hashtag, count(DISTINCT t.id)::int AS posts, coalesce(sum(CASE WHEN pm.metric IN ('likes','comments','shares','saves') THEN pm.value END),0)::float AS engagements, coalesce(sum(CASE WHEN pm.metric='impressions' THEN pm.value END),0)::float AS impressions FROM "PostTarget" t CROSS JOIN LATERAL jsonb_array_elements_text(coalesce(t.metadata->'hashtags','[]'::jsonb)) h LEFT JOIN post_metric_current pm ON pm."postTargetId" = t.id WHERE t."organizationId" = ${ctx.tenant!.organizationId}::uuid ${idFilter} AND t.status='PUBLISHED' AND t."publishedAt" BETWEEN ${r.from} AND ${r.to} GROUP BY h ORDER BY engagements DESC LIMIT ${a.limit ?? 10}`);
    return rows.map(x => ({ ...x, hashtag: `#${x.hashtag}` }));
  } }),
}));
