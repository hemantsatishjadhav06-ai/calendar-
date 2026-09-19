import { prismaAdmin } from '@cadence/db';
import { startPageRules } from '@cadence/network-rules';
import type { SocialConnector } from '../types.js';

/** Pseudo-connector: "publishing" inserts into the Start Page's Updates block. No OAuth. */
export const startPage: SocialConnector = {
  network: 'START_PAGE',
  rules: startPageRules,
  async authStart() { throw new Error('Start Page channels are created from the Start Page editor'); },
  async authCallback() { throw new Error('unsupported'); },
  async refresh(c) { return c; },
  async health() { return { ok: true }; },
  publishBudget() { return []; },
  async publish({ target, channel }) {
    const page = await prismaAdmin.startPage.findFirst({ where: { organizationId: channel.organizationId, id: (channel.meta as any).startPageId } });
    if (!page) throw new Error('Start Page not found');
    const blocks = (page.blocks as any[]) ?? [];
    const updates = blocks.find(b => b.type === 'updates');
    const item = { id: target.id, text: target.text, media: target.media, link: (target.metadata as any)?.link, publishedAt: new Date().toISOString() };
    if (updates) updates.items = [item, ...(updates.items ?? [])].slice(0, updates.count ?? 5);
    const published = page.publishedRevision as any;
    if (published) { const pu = (published.blocks ?? []).find((b: any) => b.type === 'updates'); if (pu) pu.items = [item, ...(pu.items ?? [])].slice(0, pu.count ?? 5); }
    await prismaAdmin.startPage.update({ where: { id: page.id }, data: { blocks, publishedRevision: published ?? undefined } });
    return { externalId: target.id, url: `https://${page.slug}.start.relay.app` };
  },
};
