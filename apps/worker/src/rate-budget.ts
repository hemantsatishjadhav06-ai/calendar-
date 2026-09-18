import { redis } from './infra.js';
import type { BudgetSpec } from '@relay/connectors';

const SCRIPT = `
redis.call('ZREMRANGEBYSCORE', KEYS[1], 0, tonumber(ARGV[1]) - tonumber(ARGV[2]) * 1000)
local n = redis.call('ZCARD', KEYS[1])
if n + tonumber(ARGV[4]) > tonumber(ARGV[3]) then
  local oldest = redis.call('ZRANGE', KEYS[1], 0, 0, 'WITHSCORES')
  return {0, oldest[2] or ARGV[1]}
end
for i = 1, tonumber(ARGV[4]) do redis.call('ZADD', KEYS[1], ARGV[1], ARGV[1] .. '-' .. i .. '-' .. math.random()) end
redis.call('EXPIRE', KEYS[1], ARGV[2])
return {1, 0}`;

/** Sliding-window token budgets (per channel / per app) in Redis. */
export const RateBudget = {
  async tryConsume(specs: BudgetSpec[]): Promise<{ ok: true } | { ok: false; retryAt: Date; reason: string }> {
    const now = Date.now();
    for (const s of specs) {
      const [ok, oldest] = (await redis.eval(SCRIPT, 1, `budget:${s.key}`, now, s.windowSec, s.limit, s.cost ?? 1)) as [number, string];
      if (!ok) return { ok: false, retryAt: new Date(Number(oldest) + s.windowSec * 1000 + 1000), reason: `Rate budget ${s.key} exhausted (${s.limit} per ${s.windowSec}s)` };
    }
    return { ok: true };
  },
};
