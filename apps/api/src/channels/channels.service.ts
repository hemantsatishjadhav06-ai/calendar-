import { Injectable } from '@nestjs/common';
import { prismaAdmin, type Network, type Channel } from '@relay/db';
import { getConnector, type Candidate } from '@relay/connectors';
import { tokenVault, type Creds } from '@relay/token-vault';
import { DEFAULT_SLOTS, QueueOps, entitlement, type TenantContext } from '@relay/domain';
import { within } from '@relay/entitlements';
import { QueuesService } from '../infra/queues.service.js';
import { events } from '../events/events.bus.js';

@Injectable()
export class ChannelsService {
  constructor(private queues: QueuesService) {}

  async assertCanConnect(tenant: TenantContext) {
    const count = await prismaAdmin.channel.count({ where: { organizationId: tenant.organizationId, deletedAt: null, network: { not: 'START_PAGE' } } });
    if (!within(tenant.entitlements.channels, count)) throw entitlement(`Your plan allows ${tenant.entitlements.channels} channels. Upgrade to connect more.`, 'channels');
    if (tenant.entitlements.lifetimeChannelCap) {
      const org = await prismaAdmin.organization.findUniqueOrThrow({ where: { id: tenant.organizationId } });
      const lifetime = ((org.settings as any)?.lifetimeConnections ?? []) as string[];
      if (lifetime.length >= tenant.entitlements.lifetimeChannelCap) throw entitlement('Free plans can connect up to 8 unique channels over time. Upgrade to connect more.', 'channels');
    }
  }

  async existingExternalIds(organizationId: string) {
    const rows = await prismaAdmin.channel.findMany({ where: { organizationId, deletedAt: null }, select: { network: true, externalId: true } });
    return new Set(rows.map(r => `${r.network}:${r.externalId}`));
  }

  async connect(input: { organizationId: string; accountId: string; network: Network; candidate: Candidate; creds: Creds }): Promise<Channel> {
    const { organizationId, accountId, network, candidate: c } = input;
    const channel = await prismaAdmin.channel.upsert({
      where: { organizationId_network_externalId: { organizationId, network, externalId: c.externalId } },
      create: { organizationId, network, subtype: c.subtype, externalId: c.externalId, displayName: c.displayName, handle: c.handle, avatarUrl: c.avatarUrl, meta: c.meta ?? {}, connectedByAccountId: accountId, status: 'ACTIVE', schedule: { create: DEFAULT_SLOTS } },
      update: { displayName: c.displayName, handle: c.handle, avatarUrl: c.avatarUrl, meta: c.meta ?? {}, status: 'ACTIVE', statusReason: null, deletedAt: null, connectedByAccountId: accountId },
    });
    await tokenVault.store(channel.id, input.creds);
    // Record lifetime connection (Free plan cap), grant FULL access to all existing members
    const org = await prismaAdmin.organization.findUniqueOrThrow({ where: { id: organizationId } });
    const settings = (org.settings as any) ?? {}; const key = `${network}:${c.externalId}`;
    settings.lifetimeConnections = Array.from(new Set([...(settings.lifetimeConnections ?? []), key]));
    await prismaAdmin.organization.update({ where: { id: organizationId }, data: { settings } });
    const members = await prismaAdmin.membership.findMany({ where: { organizationId, status: 'ACTIVE' }, select: { id: true } });
    await prismaAdmin.channelGrant.createMany({ data: members.map(m => ({ membershipId: m.id, channelId: channel.id, publish: settings.newChannelsNoAccess ? 'NONE' : 'FULL', community: settings.newChannelsNoAccess ? 'NONE' : 'FULL' })), skipDuplicates: true });

    const connector = getConnector(network);
    if (connector.afterConnect) await connector.afterConnect(input.creds, channel).catch(() => undefined);
    // Resume anything that was waiting on a reconnect, kick a metrics backfill and inbox poll
    await new QueueOps(prismaAdmin).reflow(channel.id);
    await this.queues.get('metrics').add('backfill', { channelId: channel.id, organizationId }, { jobId: `backfill-${channel.id}-${Date.now()}` });
    await this.queues.get('inbox').add('poll', { channelId: channel.id, organizationId }, { jobId: `inbox-first-${channel.id}` });
    events.publish(organizationId, { type: 'channel.updated', channelId: channel.id });
    await prismaAdmin.auditLog.create({ data: { organizationId, actorAccountId: accountId, action: 'channel.connect', entity: 'Channel', entityId: channel.id } });
    return channel;
  }

  async disconnect(organizationId: string, accountId: string, channelId: string) {
    const ch = await prismaAdmin.channel.findFirstOrThrow({ where: { id: channelId, organizationId } });
    const creds = await tokenVault.load(channelId).catch(() => null);
    if (creds) await getConnector(ch.network).revoke?.(creds, ch).catch(() => undefined);
    await prismaAdmin.channel.update({ where: { id: channelId }, data: { deletedAt: new Date(), status: 'DISCONNECTED' } });
    await tokenVault.delete(channelId);
    await prismaAdmin.postTarget.updateMany({ where: { channelId, status: { in: ['QUEUED', 'SCHEDULED'] } }, data: { status: 'CANCELLED' } });
    await prismaAdmin.auditLog.create({ data: { organizationId, actorAccountId: accountId, action: 'channel.disconnect', entity: 'Channel', entityId: channelId } });
    events.publish(organizationId, { type: 'channel.updated', channelId });
  }
}
