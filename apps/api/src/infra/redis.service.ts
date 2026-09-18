import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { Redis } from 'ioredis';
import { env } from '@relay/config';

@Injectable()
export class RedisService implements OnModuleDestroy {
  readonly client = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
  readonly subscriber = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
  async onModuleDestroy() { await Promise.all([this.client.quit(), this.subscriber.quit()]); }
}
