import type { Account, TenantPrisma } from '@relay/db';
import type { TenantContext } from '@relay/domain';
import type { RequestContext } from '../auth/session.middleware.js';

export interface GqlContext {
  account?: Account;
  tenant?: TenantContext;
  db?: TenantPrisma;
  apiKeyId?: string;
  isPublicApi: boolean;
  ip?: string;
}

export function buildContext(rc: RequestContext, req: any): GqlContext {
  return { account: rc.account, tenant: rc.tenant, db: rc.db, apiKeyId: rc.apiKeyId, isPublicApi: !!rc.apiKeyId, ip: req?.ip };
}
