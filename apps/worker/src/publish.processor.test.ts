/**
 * Integration tests — need DATABASE_URL_ADMIN + REDIS_URL (docker compose up). Run: pnpm --filter @cadence/worker test
 * The exactly-once guarantee is the single most important property of the system; these tests are the gate for it.
 */
import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import { prismaAdmin } from '@cadence/db';

const mockPublish = vi.fn();
vi.mock('@cadence/connectors', async importOriginal => {
  const orig: any = await importOriginal();
  const { xRules } = await import('@cadence/network-rules');
  return { ...orig, getConnector: () => ({ network: 'X', rules: orig.xRules ?? xRules, publishBudget: () => [], publish: mockPublish, refresh: async (c: any) => c }) };
});
vi.mock('@cadence/token-vault', () => ({ tokenVault: { forChannel: async () => ({ accessToken: 't', tokenType: 'bearer', extra: {} }) } }));

const { processPublishJob } = await import('./publish.processor.js');

let orgId: string, channelId: string, accountId: string;
beforeAll(async () => {
  const acc = await prismaAdmin.account.create({ data: { email: `t-${Date.now()}@relay.test` } }); accountId = acc.id;
  const org = await prismaAdmin.organization.create({ data: { name: 'T', slug: `t-${Date.now()}`, ownerAccountId: acc.id } }); orgId = org.id;
  const ch = await prismaAdmin.channel.create({ data: { organizationId: orgId, network: 'X', subtype: 'profile', externalId: `x-${Date.now()}`, displayName: 'X test', connectedByAccountId: accountId, status: 'ACTIVE' } }); channelId = ch.id;
});
afterAll(async () => {
  // FK-safe teardown: PostTarget→Channel is RESTRICT (channels are soft-deleted in the app,
  // never hard-deleted while targets reference them), so clear targets/posts/channels before the org.
  await prismaAdmin.postTarget.deleteMany({ where: { organizationId: orgId } });
  await prismaAdmin.post.deleteMany({ where: { organizationId: orgId } });
  await prismaAdmin.channel.deleteMany({ where: { organizationId: orgId } });
  await prismaAdmin.organization.delete({ where: { id: orgId } });
  await prismaAdmin.account.delete({ where: { id: accountId } });
});

async function makeTarget(text = 'hello world') {
  const post = await prismaAdmin.post.create({ data: { organizationId: orgId, createdByAccountId: accountId, status: 'SCHEDULED', baseText: text } });
  return prismaAdmin.postTarget.create({ data: { organizationId: orgId, postId: post.id, channelId, status: 'SCHEDULED', isCustomTime: true, dueAt: new Date(Date.now() - 1000), text } });
}

describe('publish processor', () => {
  it('publishes exactly once under heavy contention', async () => {
    mockPublish.mockReset(); mockPublish.mockImplementation(async () => { await new Promise(r => setTimeout(r, 50)); return { externalId: 'ext-1', url: 'https://x.com/i/status/1' }; });
    const t = await makeTarget();
    const results = await Promise.all(Array.from({ length: 50 }, () => processPublishJob({ targetId: t.id })));
    expect(mockPublish).toHaveBeenCalledTimes(1);
    expect(results.filter(r => r === 'published')).toHaveLength(1);
    const after = await prismaAdmin.postTarget.findUniqueOrThrow({ where: { id: t.id } });
    expect(after.status).toBe('PUBLISHED'); expect(after.externalPostId).toBe('ext-1');
  });

  it('defers on retryable platform errors with backoff and never marks FAILED early', async () => {
    mockPublish.mockReset(); mockPublish.mockRejectedValue(Object.assign(new Error('boom'), { name: 'ConnectorError', code: 'PLATFORM', retryable: true }));
    const t = await makeTarget();
    const r = await processPublishJob({ targetId: t.id });
    expect(r).toMatch(/^deferred/);
    const after = await prismaAdmin.postTarget.findUniqueOrThrow({ where: { id: t.id } });
    expect(after.status).toBe('SCHEDULED'); expect(after.dueAt!.getTime()).toBeGreaterThan(Date.now()); expect(after.failureCode).toBe('PLATFORM');
  });

  it('pauses the channel (not the post) on AUTH errors', async () => {
    mockPublish.mockReset(); mockPublish.mockRejectedValue(Object.assign(new Error('token expired'), { name: 'ConnectorError', code: 'AUTH', retryable: false }));
    const t = await makeTarget();
    expect(await processPublishJob({ targetId: t.id })).toBe('paused:auth');
    const ch = await prismaAdmin.channel.findUniqueOrThrow({ where: { id: channelId } });
    expect(ch.status).toBe('RECONNECT_REQUIRED');
    const after = await prismaAdmin.postTarget.findUniqueOrThrow({ where: { id: t.id } });
    expect(after.status).toBe('SCHEDULED');
    await prismaAdmin.channel.update({ where: { id: channelId }, data: { status: 'ACTIVE' } });
  });

  it('fails fast on validation errors from network rules', async () => {
    mockPublish.mockReset();
    const t = await makeTarget('x'.repeat(400));   // > 280 weighted chars for X
    expect(await processPublishJob({ targetId: t.id })).toMatch(/^failed:VALIDATION/);
    expect(mockPublish).not.toHaveBeenCalled();
  });

  it('is a no-op for targets that are not due or not claimable', async () => {
    const post = await prismaAdmin.post.create({ data: { organizationId: orgId, createdByAccountId: accountId, status: 'DRAFT', baseText: 'draft' } });
    const t = await prismaAdmin.postTarget.create({ data: { organizationId: orgId, postId: post.id, channelId, status: 'DRAFT', text: 'draft' } });
    expect(await processPublishJob({ targetId: t.id })).toBe('skipped:not-claimable');
  });
});
