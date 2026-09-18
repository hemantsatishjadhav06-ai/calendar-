import { describe, expect, it } from 'vitest';
import { monthlyPriceCents, planEntitlements } from './index.js';

describe('entitlements', () => {
  it('free plan defaults', () => { const e = planEntitlements(null); expect(e.plan).toBe('FREE'); expect(e.channels).toBe(3); expect(e.approvals).toBe(false); });
  it('team plan unlocks approvals and uncaps channels', () => { const e = planEntitlements({ plan: 'TEAM', status: 'active', channelQuantity: 12 }); expect(e.approvals).toBe(true); expect(e.channels).toBe('unlimited'); });
  it('canceled subscription falls back to free', () => { expect(planEntitlements({ plan: 'TEAM', status: 'canceled', channelQuantity: 12 }).plan).toBe('FREE'); });
});
describe('pricing', () => {
  it('matches Buffer volume tiers', () => {
    expect(monthlyPriceCents('ESSENTIALS', 10)).toBe(6000);
    expect(monthlyPriceCents('TEAM', 10)).toBe(12000);
    expect(monthlyPriceCents('ESSENTIALS', 25)).toBe(12000);
    expect(monthlyPriceCents('TEAM', 25)).toBe(18000);
    expect(monthlyPriceCents('ESSENTIALS', 50)).toBe(19500);
    expect(monthlyPriceCents('TEAM', 50)).toBe(25500);
  });
});
