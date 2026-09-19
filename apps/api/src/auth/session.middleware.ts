import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
import { AsyncLocalStorage } from 'node:async_hooks';
import { prismaAdmin, tenantClient, prismaApp, isUuid, type Account, type TenantPrisma } from '@cadence/db';
import { planEntitlements } from '@cadence/entitlements';
import type { TenantContext } from '@cadence/domain';
import { AuthService } from './auth.service.js';

export interface RequestContext {
  account?: Account;
  sessionId?: string;
  tenant?: TenantContext;
  db?: TenantPrisma;
  apiKeyId?: string;
}
export const requestStore = new AsyncLocalStorage<RequestContext>();
export const ctx = (): RequestContext => requestStore.getStore() ?? {};
export const requireTenant = (): { tenant: TenantContext; db: TenantPrisma; account: Account } => {
  const c = ctx();
  if (!c.tenant || !c.db) throw Object.assign(new Error('Sign in required'), { code: 'UNAUTHENTICATED' });
  return { tenant: c.tenant, db: c.db, account: c.account! };
};

export const SESSION_COOKIE = 'relay_session';

/** Resolves session (cookie) or API key (bearer) → account, then organization → TenantContext + RLS-scoped Prisma. */
@Injectable()
export class SessionMiddleware implements NestMiddleware {
  constructor(private auth: AuthService) {}
  async use(req: Request, res: Response, next: NextFunction) {
    const rc: RequestContext = {};
    const bearer = req.headers.authorization?.replace(/^Bearer\s+/i, '');
    let apiScopes: string[] | undefined;
    let orgId: string | undefined = (req.headers['x-organization-id'] as string) || undefined;

    if (bearer?.startsWith('rly_')) {
      const key = await this.auth.resolveApiKey(bearer);
      if (key) { rc.account = (await prismaAdmin.account.findUnique({ where: { id: key.accountId } })) ?? undefined; rc.apiKeyId = key.id; apiScopes = key.scopes; orgId ??= key.organizationId; }
    } else {
      const sid = (req.signedCookies?.[SESSION_COOKIE] as string) || (req.cookies?.[SESSION_COOKIE] as string);
      if (sid) { const s = await this.auth.getSession(sid); if (s) { rc.account = s.account; rc.sessionId = s.id; } }
    }

    if (rc.account) {
      orgId ??= rc.account.lastOrganizationId ?? undefined;
      if (orgId && isUuid(orgId)) {
        const m = await prismaAdmin.membership.findUnique({ where: { accountId_organizationId: { accountId: rc.account.id, organizationId: orgId } }, include: { organization: { include: { subscription: true } }, channelGrants: true } });
        if (m && m.status === 'ACTIVE' && !m.organization.deletedAt) {
          rc.tenant = {
            accountId: rc.account.id, organizationId: orgId, role: m.role,
            channelPermissions: Object.fromEntries(m.channelGrants.map(g => [g.channelId, { publish: g.publish, community: g.community }])),
            entitlements: planEntitlements(m.organization.subscription as any),
            apiScopes,
          };
          rc.db = tenantClient(prismaApp, orgId);
          if (rc.account.lastOrganizationId !== orgId && !apiScopes) prismaAdmin.account.update({ where: { id: rc.account.id }, data: { lastOrganizationId: orgId } }).catch(() => undefined);
        }
      }
    }
    (req as any).rc = rc;
    requestStore.run(rc, () => next());
  }
}
