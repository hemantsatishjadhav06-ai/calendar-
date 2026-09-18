import { Redis } from 'ioredis';
import { env } from '@relay/config';
import type { Entitlements } from '@relay/entitlements';

/** Public API quotas per key: 15-minute, 24-hour and 30-day rolling windows (Buffer parity). */
export class RateLimiter {
  private redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
  async check(keyId: string, ent: Entitlements) {
    const windows: [string, number, number][] = [['15m', 900, ent.apiRequestsPer15m], ['24h', 86400, ent.apiRequestsPer24h], ['30d', 30 * 86400, ent.apiRequestsPer30d]];
    const now = Date.now();
    for (const [name, sec, limit] of windows) {
      const key = `api:${keyId}:${name}`;
      const [, count] = (await this.redis.multi().zremrangebyscore(key, 0, now - sec * 1000).zcard(key).exec())!.map((r: any) => r[1]) as [unknown, number];
      if (count >= limit) {
        const oldest = await this.redis.zrange(key, 0, 0, 'WITHSCORES');
        const retryAfterSec = Math.max(1, Math.ceil((Number(oldest[1]) + sec * 1000 - now) / 1000));
        return { ok: false as const, retryAfterSec, header: `limit=${limit}, remaining=0, reset=${retryAfterSec}` };
      }
    }
    const m = this.redis.multi();
    for (const [name, sec] of windows) m.zadd(`api:${keyId}:${name}`, now, `${now}-${Math.random()}`).expire(`api:${keyId}:${name}`, sec);
    await m.exec();
    return { ok: true as const };
  }
}
