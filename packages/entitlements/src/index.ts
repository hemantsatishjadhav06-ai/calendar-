export type Plan = 'FREE' | 'ESSENTIALS' | 'TEAM';
export type Unlimited = 'unlimited';

export interface Entitlements {
  plan: Plan;
  channels: number | Unlimited;
  lifetimeChannelCap?: number;
  scheduledPerChannel: number;
  users: number | Unlimited;
  ideas: number | Unlimited;
  tags: number;
  ideaGroups: number;
  threadsScheduledPerQueue: number | Unlimited;
  analyticsHistoryDays: number | Unlimited;
  customDateRanges: boolean;
  comparisons: boolean;
  customMetricSets: boolean;
  brandedReports: boolean;
  hashtagManager: boolean;
  firstComment: boolean;
  videoCovers: boolean;
  shareNext: boolean;
  shopGrid: boolean;
  shortenerChoice: boolean;
  customUtm: boolean;
  shareAgainDays: number | Unlimited;
  approvals: boolean;
  channelPermissions: boolean;
  require2fa: boolean;
  aiRepliesPerWeek: number | Unlimited;
  savedReplies: number | Unlimited;
  apiKeys: number;
  apiClients: number;
  apiRequestsPer30d: number;
  apiRequestsPer24h: number;
  apiRequestsPer15m: number;
}

export interface SubscriptionLike { plan: Plan; status: string; channelQuantity: number }

const FREE: Entitlements = {
  plan: 'FREE', channels: 3, lifetimeChannelCap: 8, scheduledPerChannel: 10, users: 1, ideas: 100, tags: 3, ideaGroups: 3,
  threadsScheduledPerQueue: 1, analyticsHistoryDays: 30, customDateRanges: false, comparisons: false, customMetricSets: false,
  brandedReports: false, hashtagManager: false, firstComment: false, videoCovers: false, shareNext: false, shopGrid: false,
  shortenerChoice: false, customUtm: false, shareAgainDays: 30, approvals: false, channelPermissions: false, require2fa: false,
  aiRepliesPerWeek: 5, savedReplies: 1, apiKeys: 1, apiClients: 1, apiRequestsPer30d: 3000, apiRequestsPer24h: 250, apiRequestsPer15m: 100,
};

export function planEntitlements(sub?: SubscriptionLike | null): Entitlements {
  const active = sub && !['canceled', 'unpaid', 'incomplete_expired'].includes(sub.status);
  const plan: Plan = active ? sub!.plan : 'FREE';
  if (plan === 'FREE') return FREE;
  const paid: Entitlements = {
    ...FREE, plan, channels: 'unlimited', lifetimeChannelCap: undefined,   // paid plans are priced per channel (Stripe quantity), never capped scheduledPerChannel: 5000, ideas: 'unlimited', tags: 250, ideaGroups: 500,
    threadsScheduledPerQueue: 'unlimited', analyticsHistoryDays: 'unlimited', customDateRanges: true, comparisons: true, customMetricSets: true,
    hashtagManager: true, firstComment: true, videoCovers: true, shareNext: true, shopGrid: true, shortenerChoice: true, customUtm: true,
    shareAgainDays: 'unlimited', aiRepliesPerWeek: 'unlimited', savedReplies: 5, apiKeys: 3, apiClients: 3, apiRequestsPer30d: 7500,
  };
  if (plan === 'ESSENTIALS') return paid;
  return { ...paid, users: 'unlimited', brandedReports: true, approvals: true, channelPermissions: true, require2fa: true, savedReplies: 'unlimited', apiKeys: 5, apiClients: 5, apiRequestsPer30d: 15000, apiRequestsPer24h: 500 };
}

export const within = (limit: number | Unlimited, current: number) => limit === 'unlimited' || current < limit;

/** Per-channel monthly price in USD cents for a given total channel count (graduated tiers). */
export function monthlyPriceCents(plan: Exclude<Plan, 'FREE'>, channels: number, interval: 'month' | 'year' = 'month') {
  const tiers = plan === 'ESSENTIALS' ? [[10, 600], [25, 400], [50, 300], [Infinity, 100]] : [[10, 1200], [25, 400], [50, 300], [Infinity, 200]];
  let remaining = channels, prev = 0, total = 0;
  for (const [upTo, unit] of tiers) {
    const inTier = Math.max(0, Math.min(remaining, upTo - prev));
    total += inTier * unit; remaining -= inTier; prev = upTo;
    if (remaining <= 0) break;
  }
  return interval === 'year' ? Math.round(total * 12 * 0.8) : total;
}
