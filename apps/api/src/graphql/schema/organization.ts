import { randomBytes } from 'node:crypto';
import { builder } from '../builder.js';
import { OrgRoleEnum, PublishAccessEnum, CommunityAccessEnum, PlanEnum, AccountSummary } from './enums.js';
import { prismaAdmin } from '@relay/db';
import { DomainError } from '@relay/domain';
import { within } from '@relay/entitlements';
import { mail } from '../../mail/mail.js';
import { env } from '@relay/config';

builder.prismaObject('Organization', {
  fields: t => ({
    id: t.exposeID('id'),
    name: t.exposeString('name'),
    slug: t.exposeString('slug'),
    require2fa: t.exposeBoolean('require2fa'),
    settings: t.expose('settings', { type: 'JSON' }),
    createdAt: t.expose('createdAt', { type: 'DateTime' }),
    plan: t.field({ type: PlanEnum, resolve: (_o, _a, ctx) => ctx.tenant!.entitlements.plan }),
    entitlements: t.field({ type: 'JSON', resolve: (_o, _a, ctx) => ctx.tenant!.entitlements }),
    members: t.relation('memberships', { authScopes: { admin: true } }),
    channelGroups: t.relation('channelGroups'),
  }),
});

builder.prismaObject('Membership', {
  fields: t => ({
    id: t.exposeID('id'),
    role: t.expose('role', { type: OrgRoleEnum }),
    status: t.exposeString('status'),
    invitedEmail: t.exposeString('invitedEmail', { nullable: true }),
    account: t.field({ type: AccountSummary, nullable: true, resolve: async m => prismaAdmin.account.findUnique({ where: { id: m.accountId }, select: { id: true, email: true, name: true, avatarUrl: true } }) }),
    channelGrants: t.relation('channelGrants'),
    createdAt: t.expose('createdAt', { type: 'DateTime' }),
  }),
});
builder.prismaObject('ChannelGrant', { fields: t => ({ channelId: t.exposeID('channelId'), publish: t.expose('publish', { type: PublishAccessEnum }), community: t.expose('community', { type: CommunityAccessEnum }) }) });

builder.queryFields(t => ({
  organization: t.prismaField({ type: 'Organization', authScopes: { user: true }, resolve: (q, _r, _a, ctx) => ctx.db!.organization.findUniqueOrThrow({ ...q, where: { id: ctx.tenant!.organizationId } }) }),
  me: t.field({ type: AccountSummary, authScopes: { user: true }, resolve: (_r, _a, ctx) => ({ id: ctx.account!.id, email: ctx.account!.email, name: ctx.account!.name, avatarUrl: ctx.account!.avatarUrl }) }),
}));

const GrantInput = builder.inputType('ChannelGrantInput', { fields: t => ({ channelId: t.id({ required: true }), publish: t.field({ type: PublishAccessEnum, required: true }), community: t.field({ type: CommunityAccessEnum, required: true }) }) });

builder.mutationFields(t => ({
  updateOrganization: t.prismaField({
    type: 'Organization', authScopes: { admin: true },
    args: { name: t.arg.string(), require2fa: t.arg.boolean(), settings: t.arg({ type: 'JSON' }) },
    resolve: async (q, _r, args, ctx) => {
      if (args.require2fa && !ctx.tenant!.entitlements.require2fa) throw new DomainError('ENTITLEMENT', 'Requiring 2FA is available on the Team plan');
      return ctx.db!.organization.update({ ...q, where: { id: ctx.tenant!.organizationId }, data: { ...(args.name ? { name: args.name } : {}), ...(args.require2fa != null ? { require2fa: args.require2fa } : {}), ...(args.settings ? { settings: args.settings as any } : {}) } });
    },
  }),
  inviteMember: t.prismaField({
    type: 'Membership', authScopes: { admin: true },
    args: { email: t.arg.string({ required: true }), role: t.arg({ type: OrgRoleEnum, defaultValue: 'MEMBER' }), grants: t.arg({ type: [GrantInput] }) },
    resolve: async (q, _r, args, ctx) => {
      const tenant = ctx.tenant!;
      const count = await prismaAdmin.membership.count({ where: { organizationId: tenant.organizationId, status: { in: ['ACTIVE', 'INVITED'] } } });
      if (!within(tenant.entitlements.users, count)) throw new DomainError('ENTITLEMENT', 'Your plan allows one user. Upgrade to Team to invite your team.', undefined, { feature: 'users' });
      if (args.grants?.length && !tenant.entitlements.channelPermissions) throw new DomainError('ENTITLEMENT', 'Per-channel permissions are available on the Team plan');
      const email = args.email.trim().toLowerCase();
      let account = await prismaAdmin.account.findUnique({ where: { email } });
      account ??= await prismaAdmin.account.create({ data: { email } });        // placeholder account; completes on accept
      const token = randomBytes(24).toString('base64url');
      const channels = await prismaAdmin.channel.findMany({ where: { organizationId: tenant.organizationId, deletedAt: null }, select: { id: true } });
      const grants = args.grants?.length ? args.grants : channels.map(c => ({ channelId: c.id, publish: 'FULL' as const, community: 'FULL' as const }));
      const m = await prismaAdmin.membership.upsert({
        where: { accountId_organizationId: { accountId: account.id, organizationId: tenant.organizationId } },
        create: { accountId: account.id, organizationId: tenant.organizationId, role: args.role ?? 'MEMBER', status: 'INVITED', invitedEmail: email, inviteToken: token, invitedByAccountId: tenant.accountId, channelGrants: { create: grants.map(g => ({ channelId: g.channelId, publish: g.publish, community: g.community })) } },
        update: { role: args.role ?? 'MEMBER', status: 'INVITED', inviteToken: token, invitedByAccountId: tenant.accountId },
        ...q,
      });
      const org = await prismaAdmin.organization.findUniqueOrThrow({ where: { id: tenant.organizationId } });
      await mail.send({ to: email, template: 'invite', data: { orgName: org.name, inviter: ctx.account!.name ?? ctx.account!.email, url: `${env.APP_URL}/invite/${token}` } });
      await prismaAdmin.auditLog.create({ data: { organizationId: tenant.organizationId, actorAccountId: tenant.accountId, action: 'member.invite', entity: 'Membership', entityId: m.id, diff: { email, role: args.role } } });
      return m;
    },
  }),
  updateMember: t.prismaField({
    type: 'Membership', authScopes: { admin: true },
    args: { membershipId: t.arg.id({ required: true }), role: t.arg({ type: OrgRoleEnum }), grants: t.arg({ type: [GrantInput] }) },
    resolve: async (q, _r, args, ctx) => {
      const tenant = ctx.tenant!;
      const m = await prismaAdmin.membership.findFirstOrThrow({ where: { id: String(args.membershipId), organizationId: tenant.organizationId } });
      const org = await prismaAdmin.organization.findUniqueOrThrow({ where: { id: tenant.organizationId } });
      if (m.accountId === org.ownerAccountId && args.role && args.role !== 'OWNER') throw new DomainError('VALIDATION', 'Transfer ownership before changing the owner role');
      if (args.grants && !tenant.entitlements.channelPermissions) throw new DomainError('ENTITLEMENT', 'Per-channel permissions are available on the Team plan');
      if (args.grants) { await prismaAdmin.channelGrant.deleteMany({ where: { membershipId: m.id } }); await prismaAdmin.channelGrant.createMany({ data: args.grants.map(g => ({ membershipId: m.id, channelId: String(g.channelId), publish: g.publish, community: g.community })) }); }
      return prismaAdmin.membership.update({ ...q, where: { id: m.id }, data: { ...(args.role ? { role: args.role } : {}) } });
    },
  }),
  removeMember: t.boolean({
    authScopes: { admin: true }, args: { membershipId: t.arg.id({ required: true }) },
    resolve: async (_r, args, ctx) => {
      const tenant = ctx.tenant!;
      const m = await prismaAdmin.membership.findFirstOrThrow({ where: { id: String(args.membershipId), organizationId: tenant.organizationId } });
      const org = await prismaAdmin.organization.findUniqueOrThrow({ where: { id: tenant.organizationId } });
      if (m.accountId === org.ownerAccountId) throw new DomainError('VALIDATION', 'The organization owner cannot be removed');
      await prismaAdmin.membership.delete({ where: { id: m.id } });
      await prismaAdmin.auditLog.create({ data: { organizationId: tenant.organizationId, actorAccountId: tenant.accountId, action: 'member.remove', entity: 'Membership', entityId: m.id } });
      return true;
    },
  }),
  acceptInvite: t.field({
    type: 'JSON', authScopes: { user: true }, args: { token: t.arg.string({ required: true }) },
    resolve: async (_r, args, ctx) => {
      const m = await prismaAdmin.membership.findUnique({ where: { inviteToken: args.token } });
      if (!m) throw new DomainError('NOT_FOUND', 'Invite not found or already used');
      if (m.accountId !== ctx.account!.id) {
        // invite created a placeholder account for the email; merge into the signed-in account
        await prismaAdmin.membership.update({ where: { id: m.id }, data: { accountId: ctx.account!.id } });
      }
      await prismaAdmin.membership.update({ where: { id: m.id }, data: { status: 'ACTIVE', inviteToken: null } });
      await prismaAdmin.account.update({ where: { id: ctx.account!.id }, data: { lastOrganizationId: m.organizationId } });
      return { organizationId: m.organizationId };
    },
  }),
  switchOrganization: t.boolean({
    authScopes: { user: true }, args: { organizationId: t.arg.id({ required: true }) },
    resolve: async (_r, args, ctx) => {
      const m = await prismaAdmin.membership.findUnique({ where: { accountId_organizationId: { accountId: ctx.account!.id, organizationId: String(args.organizationId) } } });
      if (!m || m.status !== 'ACTIVE') throw new DomainError('FORBIDDEN', 'Not a member of that organization');
      await prismaAdmin.account.update({ where: { id: ctx.account!.id }, data: { lastOrganizationId: m.organizationId } });
      return true;
    },
  }),
  createOrganization: t.prismaField({
    type: 'Organization', authScopes: { user: true }, args: { name: t.arg.string({ required: true }) },
    resolve: async (q, _r, args, ctx) => {
      const base = args.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'org';
      let slug = base, i = 1; while (await prismaAdmin.organization.findUnique({ where: { slug } })) slug = `${base}-${++i}`;
      const org = await prismaAdmin.organization.create({ ...q, data: { name: args.name, slug, ownerAccountId: ctx.account!.id, memberships: { create: { accountId: ctx.account!.id, role: 'OWNER' } }, subscription: { create: {} } } });
      await prismaAdmin.account.update({ where: { id: ctx.account!.id }, data: { lastOrganizationId: org.id } });
      return org;
    },
  }),
}));
