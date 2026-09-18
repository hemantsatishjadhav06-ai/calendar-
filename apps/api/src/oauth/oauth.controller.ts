import { Body, Controller, Get, Param, Post, Query, Res, UnauthorizedException, BadRequestException } from '@nestjs/common';
import type { Response } from 'express';
import { randomBytes } from 'node:crypto';
import { env } from '@cadence/config';
import type { Network } from '@cadence/db';
import { prismaAdmin } from '@cadence/db';
import { getConnector, blueskyClientMetadata, blueskyJwks, NETWORK_CATALOG, networkConfigured } from '@cadence/connectors';
import { assertCan } from '@cadence/domain';
import { requireTenant } from '../auth/session.middleware.js';
import { readConnectToken } from '../share/share.token.js';
import { RedisService } from '../infra/redis.service.js';
import { ChannelsService } from '../channels/channels.service.js';

const NETWORKS = new Set<string>(['FACEBOOK', 'INSTAGRAM', 'THREADS', 'X', 'LINKEDIN', 'TIKTOK', 'YOUTUBE', 'PINTEREST', 'GOOGLE_BUSINESS', 'BLUESKY', 'MASTODON', 'DEVTO', 'DISCORD']);

@Controller('oauth')
export class OAuthController {
  constructor(private redis: RedisService, private channels: ChannelsService) {}

  // Bluesky client metadata documents (public, unauthenticated)
  @Get('bluesky/client-metadata.json') async bskyMeta() { return blueskyClientMetadata(); }
  @Get('bluesky/jwks.json') async bskyJwks() { return blueskyJwks(); }

  @Get(':network/start')
  async start(@Param('network') network: string, @Query('hint') hint: string | undefined, @Res() res: Response) {
    const { tenant } = requireTenant();
    if (!NETWORKS.has(network)) throw new BadRequestException('Unknown network');
    assertCan(tenant, 'channel.manage');
    await this.channels.assertCanConnect(tenant);
    const redirectUri = `${env.API_URL}/oauth/${network}/callback`;
    const start = await getConnector(network as Network).authStart({ redirectUri, organizationId: tenant.organizationId, hint });
    await this.redis.client.setex(`oauth:${start.state}`, 600, JSON.stringify({ ...start, network, organizationId: tenant.organizationId, accountId: tenant.accountId, redirectUri }));
    res.redirect(start.url);
  }

  @Get(':network/callback')
  async callback(@Param('network') network: string, @Query() q: Record<string, string>, @Res() res: Response) {
    const raw = await this.redis.client.getdel(`oauth:${q.state}`);
    if (!raw) return res.redirect(`${env.APP_URL}/channels?error=${encodeURIComponent('Sign-in expired, please try again')}`);
    const st = JSON.parse(raw);
    if (q.error) return res.redirect(`${env.APP_URL}/channels?error=${encodeURIComponent(q.error_description ?? q.error)}`);
    try {
      const result = await getConnector(network as Network).authCallback({ code: q.code, state: q.state, redirectUri: st.redirectUri, codeVerifier: st.codeVerifier, extra: { ...(st.extra ?? {}), iss: q.iss } });
      const pickId = randomBytes(16).toString('hex');
      await this.redis.client.setex(`oauth:pick:${pickId}`, 900, JSON.stringify({ ...st, result }));
      // Auto-connect when there is exactly one candidate and it belongs to this network
      const own = result.candidates.filter(c => !(c.meta as any)?.network || (c.meta as any).network === network);
      const base = st.connectToken ? `${env.APP_URL}/connect/${st.connectToken}` : `${env.APP_URL}/channels`;
      if (own.length === 1 && result.candidates.length === 1) {
        await this.connectInternal(pickId, [own[0].externalId], st.organizationId, st.accountId);
        return res.redirect(`${base}?connected=1`);
      }
      return res.redirect(st.connectToken ? `${base}?pick=${pickId}&network=${network}` : `${env.APP_URL}/channels/connect/${network}/select?pick=${pickId}`);
    } catch (e: any) {
      return res.redirect(`${env.APP_URL}/channels?error=${encodeURIComponent(e.message ?? 'Connection failed')}`);
    }
  }

  @Get('pick/:pickId')
  async candidates(@Param('pickId') pickId: string) {
    const { tenant } = requireTenant();
    const st = await this.load(pickId, tenant.organizationId);
    const existing = await this.channels.existingExternalIds(tenant.organizationId);
    return { network: st.network, candidates: st.result.candidates.map((c: any) => ({ externalId: c.externalId, subtype: c.subtype, displayName: c.displayName, handle: c.handle, avatarUrl: c.avatarUrl, network: c.meta?.network ?? st.network, alreadyConnected: existing.has(`${c.meta?.network ?? st.network}:${c.externalId}`) })) };
  }

  @Post('pick/:pickId/connect')
  async connect(@Param('pickId') pickId: string, @Body() body: { externalIds: string[] }) {
    const { tenant } = requireTenant();
    const created = await this.connectInternal(pickId, body.externalIds ?? [], tenant.organizationId, tenant.accountId);
    return { channels: created };
  }

  // ── Self-serve connection links (public, token-scoped). A client connects their OWN channels to
  //    someone else's workspace without a Cadence account. The token carries the organizationId; the
  //    org owner is recorded as the connector of record.
  @Get('connect/:token/networks')
  async connectNetworks(@Param('token') token: string) {
    const org = readConnectToken(token);
    if (!org) throw new BadRequestException('This connection link is invalid or has expired');
    const o = await prismaAdmin.organization.findUnique({ where: { id: org }, select: { name: true, deletedAt: true } });
    if (!o || o.deletedAt) throw new BadRequestException('This workspace is no longer available');
    return { org: o.name, networks: NETWORK_CATALOG.filter(n => networkConfigured(n.network)).map(n => ({ network: n.network, label: n.label, needsHint: n.needsHint, note: n.note })) };
  }

  @Get('connect/:token/start/:network')
  async connectStart(@Param('token') token: string, @Param('network') network: string, @Query('hint') hint: string | undefined, @Res() res: Response) {
    const org = readConnectToken(token);
    const bail = (m: string) => res.redirect(`${env.APP_URL}/connect/${token}?error=${encodeURIComponent(m)}`);
    if (!org || !NETWORKS.has(network)) return bail('This connection link is invalid or has expired');
    if (!networkConfigured(network as Network)) return bail('That network is not set up');
    const owner = await prismaAdmin.organization.findUnique({ where: { id: org }, select: { ownerAccountId: true, deletedAt: true } });
    if (!owner || owner.deletedAt) return bail('This workspace is no longer available');
    const redirectUri = `${env.API_URL}/oauth/${network}/callback`;
    const start = await getConnector(network as Network).authStart({ redirectUri, organizationId: org, hint });
    await this.redis.client.setex(`oauth:${start.state}`, 600, JSON.stringify({ ...start, network, organizationId: org, accountId: owner.ownerAccountId, redirectUri, connectToken: token }));
    res.redirect(start.url);
  }

  @Get('connect/:token/pick/:pickId')
  async connectCandidates(@Param('token') token: string, @Param('pickId') pickId: string) {
    const org = readConnectToken(token);
    if (!org) throw new BadRequestException('This connection link is invalid or has expired');
    const st = await this.load(pickId, org);
    const existing = await this.channels.existingExternalIds(org);
    return { network: st.network, candidates: st.result.candidates.map((c: any) => ({ externalId: c.externalId, subtype: c.subtype, displayName: c.displayName, handle: c.handle, avatarUrl: c.avatarUrl, network: c.meta?.network ?? st.network, alreadyConnected: existing.has(`${c.meta?.network ?? st.network}:${c.externalId}`) })) };
  }

  @Post('connect/:token/pick/:pickId/connect')
  async connectPublic(@Param('token') token: string, @Param('pickId') pickId: string, @Body() body: { externalIds: string[] }) {
    const org = readConnectToken(token);
    if (!org) throw new BadRequestException('This connection link is invalid or has expired');
    const owner = await prismaAdmin.organization.findUnique({ where: { id: org }, select: { ownerAccountId: true } });
    if (!owner) throw new BadRequestException('This workspace is no longer available');
    const created = await this.connectInternal(pickId, body.externalIds ?? [], org, owner.ownerAccountId);
    return { connected: created.length };
  }

  private async load(pickId: string, organizationId: string) {
    const raw = await this.redis.client.get(`oauth:pick:${pickId}`);
    if (!raw) throw new BadRequestException('This connection request has expired');
    const st = JSON.parse(raw);
    if (st.organizationId !== organizationId) throw new UnauthorizedException();
    return st;
  }

  private async connectInternal(pickId: string, externalIds: string[], organizationId: string, accountId: string) {
    const st = await this.load(pickId, organizationId);
    const out = [];
    for (const ext of externalIds) {
      const c = st.result.candidates.find((x: any) => x.externalId === ext);
      if (!c) continue;
      out.push(await this.channels.connect({ organizationId, accountId, network: (c.meta?.network ?? st.network) as Network, candidate: c, creds: { ...st.result.creds, ...(c.credsOverride ?? {}), extra: { ...(st.result.creds.extra ?? {}), ...(c.credsOverride?.extra ?? {}) } } }));
    }
    await this.redis.client.del(`oauth:pick:${pickId}`);
    return out;
  }
}
