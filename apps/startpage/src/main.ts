/**
 * Public Start Page host: <slug>.start.relay.app and start.relay.app/<slug>.
 * Hono server, HTML cached in Redis (invalidated on publish), click tracking via /go/<blockId>?u=…, no cookies.
 */
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { createHash } from 'node:crypto';
import { Redis } from 'ioredis';
import { env } from '@cadence/config';
import { prismaAdmin } from '@cadence/db';
import { renderStartPage } from '../../web/src/components/startpage/render.js';

const app = new Hono();
const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
const slugOf = (c: any) => { const host = c.req.header('host') ?? ''; const sub = host.split('.')[0]; const fromHost = host.includes('.start.') ? sub : null; return (fromHost ?? c.req.param('slug') ?? '').toLowerCase(); };

app.get('/healthz', c => c.text('ok'));

app.post('/api/revalidate', async c => {
  if (c.req.query('secret') !== env.SESSION_SECRET) return c.text('forbidden', 403);
  const slug = slugOf(c); await redis.del(`sp:html:${slug}`); return c.json({ ok: true });
});

app.get('/go/:blockId', async c => {
  const slug = slugOf(c); const u = c.req.query('u') ?? '';
  if (!/^https?:\/\//i.test(u) && !/^mailto:/i.test(u)) return c.text('bad link', 400);
  const page = await prismaAdmin.startPage.findUnique({ where: { slug }, select: { id: true, organizationId: true } });
  if (page) track(page, 'click', c, c.req.param('blockId'));
  return c.redirect(u, 302);
});

app.get('/:slug?', async c => {
  const slug = slugOf(c); if (!slug) return c.redirect(env.APP_URL);
  let html = await redis.get(`sp:html:${slug}`);
  const page = await prismaAdmin.startPage.findUnique({ where: { slug } });
  if (!page || !page.publishedAt || !page.publishedRevision) return c.html(notFound(), 404);
  if (!html) {
    const rev = page.publishedRevision as any;
    // Hydrate the Updates block from the latest published Start Page posts
    const blocks = (rev.blocks as any[]).map(b => b.type === 'updates' ? { ...b, items: b.items ?? [] } : b);
    html = renderStartPage({ nickname: rev.nickname ?? page.nickname, theme: rev.theme, header: rev.header, blocks }, slug, { goBase: '' });
    await redis.setex(`sp:html:${slug}`, 300, html);
  }
  track(page, 'view', c);
  c.header('cache-control', 'public, max-age=60, s-maxage=300');
  c.header('x-frame-options', 'DENY'); c.header('referrer-policy', 'strict-origin-when-cross-origin');
  return c.html(html);
});

function track(page: { id: string; organizationId: string }, event: 'view' | 'click', c: any, blockId?: string) {
  const ua = c.req.header('user-agent') ?? '';
  if (/bot|crawl|spider|preview|facebookexternalhit|Slackbot|Twitterbot/i.test(ua)) return;
  const country = c.req.header('cf-ipcountry') ?? c.req.header('x-country') ?? null;
  const referrer = (c.req.header('referer') ?? '').slice(0, 300) || null;
  prismaAdmin.$executeRaw`INSERT INTO start_page_events (ts, start_page_id, organization_id, event, block_id, referrer, country) VALUES (now(), ${page.id}::uuid, ${page.organizationId}::uuid, ${event}, ${blockId ?? null}, ${referrer}, ${country})`.catch(() => undefined);
  void createHash;
}
const notFound = () => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Page not found</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font-family:system-ui;display:grid;place-items:center;min-height:100vh;margin:0;color:#1F1D1A;background:#FCFBF9;text-align:center}a{color:#3B7A27}</style></head><body><main><h1>This page isn't live</h1><p>The link may be wrong, or the page was unpublished.</p><p><a href="${env.APP_URL}">Create your own Start Page with Cadence</a></p></main></body></html>`;

serve({ fetch: app.fetch, port: Number(process.env.PORT ?? 4100) }, i => console.log(`startpage listening on ${i.port}`));
