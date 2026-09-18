import { Redis } from 'ioredis';
import { randomBytes } from 'node:crypto';
import { env } from '@relay/config';

let redis: Redis | undefined;
export const vaultRedis = () => (redis ??= new Redis(env.REDIS_URL, { maxRetriesPerRequest: null }));

/** Simple Redis lock (SET NX PX) with owner token; waits up to `waitMs` polling every 100 ms. */
export async function withLock<T>(key: string, ttlMs: number, fn: () => Promise<T>, waitMs = 30_000): Promise<T> {
  const r = vaultRedis();
  const token = randomBytes(12).toString('hex');
  const deadline = Date.now() + waitMs;
  while (true) {
    const ok = await r.set(`lock:${key}`, token, 'PX', ttlMs, 'NX');
    if (ok) break;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for lock ${key}`);
    await new Promise(res => setTimeout(res, 100));
  }
  try { return await fn(); }
  finally {
    await r.eval(`if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end`, 1, `lock:${key}`, token);
  }
}
