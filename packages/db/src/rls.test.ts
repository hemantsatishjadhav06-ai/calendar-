/** Tenant isolation: the RLS-enforced role must never see another organization's rows. Requires a migrated DB. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prismaAdmin, prismaApp, tenantClient } from './index.js';

let a: string, b: string, acc: string;
beforeAll(async () => {
  const account = await prismaAdmin.account.create({ data: { email: `rls-${Date.now()}@relay.test` } }); acc = account.id;
  a = (await prismaAdmin.organization.create({ data: { name: 'A', slug: `a-${Date.now()}`, ownerAccountId: acc } })).id;
  b = (await prismaAdmin.organization.create({ data: { name: 'B', slug: `b-${Date.now()}`, ownerAccountId: acc } })).id;
  for (const org of [a, b]) await prismaAdmin.post.create({ data: { organizationId: org, createdByAccountId: acc, baseText: `post of ${org}` } });
});
afterAll(async () => { await prismaAdmin.organization.deleteMany({ where: { id: { in: [a, b] } } }); await prismaAdmin.account.delete({ where: { id: acc } }); });

describe('row-level security', () => {
  it('tenant A cannot read tenant B posts', async () => {
    const dbA = tenantClient(prismaApp, a);
    const posts = await dbA.post.findMany();
    expect(posts.every(p => p.organizationId === a)).toBe(true);
    expect(posts.some(p => p.organizationId === b)).toBe(false);
  });
  it('tenant A cannot write into tenant B', async () => {
    const dbA = tenantClient(prismaApp, a);
    await expect(dbA.post.create({ data: { organizationId: b, createdByAccountId: acc, baseText: 'evil' } })).rejects.toThrow();
  });
  it('the app role has no access to credentials', async () => {
    await expect(prismaApp.channelCredential.findMany()).rejects.toThrow(/permission denied/i);
  });
  it('without a tenant setting, the app role sees nothing', async () => {
    expect(await prismaApp.post.findMany()).toHaveLength(0);
  });
});
