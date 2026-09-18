import type { TenantContext } from './tenant.js';
import { forbidden } from './errors.js';

export type Action =
  | 'post.create' | 'post.publish' | 'post.approve' | 'post.delete'
  | 'channel.manage' | 'channel.settings'
  | 'org.billing' | 'org.members' | 'org.settings'
  | 'community.reply' | 'community.view'
  | 'insights.view' | 'report.manage'
  | 'ideas.manage' | 'tags.manage';

export function isAdmin(ctx: TenantContext) {
  return ctx.role === 'OWNER' || ctx.role === 'ADMIN';
}

export function can(ctx: TenantContext, action: Action, channelId?: string): boolean {
  const admin = isAdmin(ctx);
  const g = channelId ? ctx.channelPermissions[channelId] : undefined;
  // Non-admins without any grant on a channel (e.g. channel connected after invite) inherit FULL unless org opted out; grants are materialised on connect, so absence = NONE.
  const pub = g?.publish ?? 'NONE';
  const com = g?.community ?? 'NONE';
  switch (action) {
    case 'org.billing': case 'org.members': case 'org.settings': case 'channel.manage': case 'report.manage':
      return admin;
    case 'post.create':
      return admin || pub === 'FULL' || pub === 'APPROVAL';
    case 'post.publish': case 'post.approve': case 'channel.settings': case 'post.delete':
      return admin || pub === 'FULL';
    case 'community.reply':
      return admin || com === 'FULL';
    case 'community.view':
      return admin || com !== 'NONE';
    case 'insights.view':
      return admin || pub !== 'NONE' || com !== 'NONE';
    case 'ideas.manage': case 'tags.manage':
      return true;
  }
}

export function assertCan(ctx: TenantContext, action: Action, channelId?: string) {
  if (!can(ctx, action, channelId)) throw forbidden(`Missing permission: ${action}`);
}

/** Needs-approval members may only create drafts / request approval. */
export function requiresApproval(ctx: TenantContext, channelId: string) {
  if (isAdmin(ctx)) return false;
  return ctx.channelPermissions[channelId]?.publish === 'APPROVAL';
}

export function hasApiScope(ctx: TenantContext, scope: string) {
  return !ctx.apiScopes || ctx.apiScopes.includes(scope);
}
