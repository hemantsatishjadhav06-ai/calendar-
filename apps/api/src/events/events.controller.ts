import { Controller, Get, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { requireTenant } from '../auth/session.middleware.js';
import { RedisService } from '../infra/redis.service.js';
import { events } from './events.bus.js';

/** Server-Sent Events: one stream per browser tab, filtered to the tenant's organization. */
@Controller('events')
export class EventsController {
  constructor(private redis: RedisService) {}

  @Get()
  async stream(@Req() req: Request, @Res() res: Response) {
    const { tenant } = requireTenant();
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive', 'x-accel-buffering': 'no' });
    res.write(`retry: 3000\n\n`);
    const channel = events.channel(tenant.organizationId);
    const sub = this.redis.subscriber.duplicate();
    await sub.subscribe(channel);
    const onMessage = (_ch: string, msg: string) => { res.write(`event: relay\ndata: ${msg}\n\n`); };
    sub.on('message', onMessage);
    const ping = setInterval(() => res.write(`: ping ${Date.now()}\n\n`), 25_000);
    req.on('close', async () => { clearInterval(ping); sub.off('message', onMessage); await sub.unsubscribe(channel).catch(() => undefined); await sub.quit().catch(() => undefined); });
  }
}
