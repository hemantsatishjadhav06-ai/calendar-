import type { OrgRole, PublishAccess, CommunityAccess } from '@relay/db';
import type { Entitlements } from '@relay/entitlements';

export interface TenantContext {
  accountId: string;
  organizationId: string;
  role: OrgRole;
  channelPermissions: Record<string, { publish: PublishAccess; community: CommunityAccess }>;
  entitlements: Entitlements;
  /** Public-API calls carry scopes; browser sessions carry undefined (= all). */
  apiScopes?: string[];
}
