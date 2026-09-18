import { Body, Controller, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { prismaAdmin } from '@relay/db';
import { runAssistant, suggestReply, takeaways } from '@relay/ai';
import { DomainError, entitlement } from '@relay/domain';
import { requireTenant } from '../auth/session.middleware.js';
import { RedisService } from '../infra/redis.service.js';

const Assist = z.object({ action: z.enum(['generate', 'rephrase', 'shorten', 'expand', 'casual', 'formal', 'repurpose', 'summarize', 'ideas', 'alt_text', 'hashtags', 'translate']), input: z.string().max(8000), network: z.string().optional(), maxChars: z.number().optional(), count: z.number().max(10).optional(), imageUrl: z.string().url().optional(), targetLanguage: z.string().optional() });

@Controller('ai')
export class AiController {
  constructor(private redis: RedisService) {}

  /** Streams plain text chunks (text/event-stream) for the composer side panel. */
  @Post('assist')
  async assist(@Body() body: unknown, @Res() res: Response) {
    const { tenant, account } = requireTenant();
    const input = Assist.parse(body);
    if (input.action === 'generate' && input.input.trim().split(/\s+/).length < 4) throw new DomainError('VALIDATION', 'Describe what you want in at least four words', 'input');
    // Per-org daily guard rail (tokens are cheap; abuse is not)
    const key = `ai:calls:${tenant.organizationId}:${new Date().toISOString().slice(0, 10)}`;
    const n = await this.redis.client.incr(key); await this.redis.client.expire(key, 86400);
    if (n > 2000) throw new DomainError('RATE_LIMITED', 'Daily AI limit reached for this organization');
    const org = await prismaAdmin.organization.findUniqueOrThrow({ where: { id: tenant.organizationId } });
    const result = runAssistant({ ...input, organizationId: tenant.organizationId, accountId: account.id, brandVoice: (org.settings as any)?.brandVoice });
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
    try { for await (const delta of result.textStream) res.write(`data: ${JSON.stringify(delta)}\n\n`); res.write('event: done\ndata: {}\n\n'); }
    catch (e: any) { res.write(`event: error\ndata: ${JSON.stringify(e.message)}\n\n`); }
    res.end();
  }

  @Post('suggest-reply')
  async reply(@Body() body: { commentId: string }) {
    const { tenant, account, db } = requireTenant();
    const ent = tenant.entitlements;
    if (ent.aiRepliesPerWeek !== 'unlimited') {
      const weekKey = `ai:replies:${tenant.organizationId}:${weekOf(new Date())}`;
      const used = Number(await this.redis.client.get(weekKey));
      if (used >= ent.aiRepliesPerWeek) throw entitlement(`Free plans include ${ent.aiRepliesPerWeek} AI reply suggestions per week`, 'aiReplies');
      await this.redis.client.multi().incr(weekKey).expire(weekKey, 8 * 86400).exec();
    }
    const c = await db.comment.findFirstOrThrow({ where: { id: body.commentId }, include: { channel: true, postTarget: true } });
    const tone = await db.comment.findMany({ where: { channelId: c.channelId, isOurs: true }, orderBy: { externalCreatedAt: 'desc' }, take: 20, select: { text: true } });
    const saved = await db.savedReply.findMany({ where: { organizationId: tenant.organizationId }, take: 20 });
    const text = await suggestReply({ text: c.text, postText: c.postTarget?.text, network: c.channel.network, toneExamples: tone.map(t => t.text), savedReplies: saved, organizationId: tenant.organizationId, accountId: account.id });
    return { text };
  }

  @Post('takeaways')
  async takeaways(@Body() body: { channelIds?: string[] }) {
    const { tenant, account, db } = requireTenant();
    const since = new Date(Date.now() - 30 * 864e5), prev = new Date(Date.now() - 60 * 864e5);
    const where = { organizationId: tenant.organizationId, status: 'PUBLISHED' as const, ...(body.channelIds?.length ? { channelId: { in: body.channelIds } } : {}) };
    const [cur, before] = await Promise.all([db.postTarget.count({ where: { ...where, publishedAt: { gte: since } } }), db.postTarget.count({ where: { ...where, publishedAt: { gte: prev, lt: since } } })]);
    const facts: { label: string; detail: string }[] = [];
    if (before > 0 && cur < before * 0.7) facts.push({ label: 'Posting frequency dropped', detail: `${cur} posts in the last 30 days vs ${before} the 30 days before` });
    if (cur === 0) facts.push({ label: 'No posts published in 30 days', detail: 'Schedule a few posts to restart momentum' });
    const top = await db.$queryRaw<{ id: string; text: string; score: number; publishedAt: Date }[]>`SELECT t.id, t.text, t."publishedAt", coalesce(sum(CASE WHEN pm.metric IN ('likes','comments','shares','saves') THEN pm.value END),0)::float AS score FROM "PostTarget" t LEFT JOIN post_metric_current pm ON pm."postTargetId" = t.id WHERE t."organizationId" = ${tenant.organizationId}::uuid AND t.status = 'PUBLISHED' AND t."publishedAt" > now() - interval '180 days' GROUP BY t.id ORDER BY score DESC LIMIT 1`;
    if (top[0] && Date.now() - top[0].publishedAt.getTime() > 30 * 864e5) facts.push({ label: 'Repost your best content', detail: `"${top[0].text.slice(0, 60)}" earned ${Math.round(top[0].score)} interactions and is over 30 days old` });
    return { takeaways: await takeaways(facts, tenant.organizationId, account.id) };
  }
}
const weekOf = (d: Date) => { const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); const day = t.getUTCDay() || 7; t.setUTCDate(t.getUTCDate() + 4 - day); const y = new Date(Date.UTC(t.getUTCFullYear(), 0, 1)); return `${t.getUTCFullYear()}-W${Math.ceil(((t.getTime() - y.getTime()) / 864e5 + 1) / 7)}`; };
