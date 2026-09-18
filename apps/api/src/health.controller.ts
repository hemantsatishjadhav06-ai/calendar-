import { Controller, Get } from '@nestjs/common';
import { prismaApp } from '@cadence/db';
import { RedisService } from './infra/redis.service.js';

@Controller()
export class HealthController {
  constructor(private redis: RedisService) {}
  @Get('health')
  async health() {
    const [db, cache] = await Promise.all([prismaApp.$queryRaw`SELECT 1`.then(() => 'ok').catch((e: any) => `error: ${e.message}`), this.redis.client.ping().then(() => 'ok').catch((e: any) => `error: ${e.message}`)]);
    return { status: db === 'ok' && cache === 'ok' ? 'ok' : 'degraded', db, redis: cache, time: new Date().toISOString() };
  }
}
