import { Controller, Get, Param, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { createHash } from 'node:crypto';
import { prismaAdmin } from '@relay/db';

/** rly.to/<slug> → 302 + click event (no cookies). */
@Controller('r')
export class ShortLinkController {
  @Get(':slug')
  async go(@Param('slug') slug: string, @Req() req: Request, @Res() res: Response) {
    const link = await prismaAdmin.shortLink.findUnique({ where: { slug } });
    if (!link) return res.status(404).send('Link not found');
    res.redirect(302, link.targetUrl);
    const ua = String(req.headers['user-agent'] ?? '');
    const family = /bot|crawl|spider|facebookexternalhit|Twitterbot|Slackbot|LinkedInBot/i.test(ua) ? 'bot' : /Mobile|Android|iPhone/i.test(ua) ? 'mobile' : 'desktop';
    if (family === 'bot') return;
    const ipHash = createHash('sha256').update(`${req.ip}:${new Date().toISOString().slice(0, 10)}`).digest('hex').slice(0, 24);
    prismaAdmin.$executeRaw`INSERT INTO short_link_clicks (ts, short_link_id, organization_id, country, referrer, ua_family, ip_hash) VALUES (now(), ${link.id}::uuid, ${link.organizationId}::uuid, ${String(req.headers['cf-ipcountry'] ?? req.headers['x-country'] ?? '')}, ${String(req.headers.referer ?? '').slice(0, 300)}, ${family}, ${ipHash})`.catch(() => undefined);
  }
}
