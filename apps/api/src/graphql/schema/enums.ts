import { builder } from '../builder.js';

export const NetworkEnum = builder.enumType('Network', { values: ['FACEBOOK', 'INSTAGRAM', 'THREADS', 'X', 'LINKEDIN', 'TIKTOK', 'YOUTUBE', 'PINTEREST', 'GOOGLE_BUSINESS', 'BLUESKY', 'MASTODON', 'DEVTO', 'DISCORD', 'START_PAGE'] as const });
export const ChannelStatusEnum = builder.enumType('ChannelStatus', { values: ['ACTIVE', 'RECONNECT_REQUIRED', 'LOCKED', 'DISCONNECTED'] as const });
export const PostStatusEnum = builder.enumType('PostStatus', { values: ['DRAFT', 'PENDING_APPROVAL', 'QUEUED', 'SCHEDULED', 'PUBLISHING', 'PUBLISHED', 'PARTIALLY_PUBLISHED', 'FAILED', 'NOTIFIED', 'CANCELLED'] as const });
export const ScheduleModeEnum = builder.enumType('ScheduleMode', { values: ['QUEUE', 'SHARE_NEXT', 'CUSTOM', 'NOW', 'DRAFT'] as const });
export const SchedulingTypeEnum = builder.enumType('SchedulingType', { values: ['AUTOMATIC', 'NOTIFICATION'] as const });
export const OrgRoleEnum = builder.enumType('OrgRole', { values: ['OWNER', 'ADMIN', 'MEMBER'] as const });
export const PublishAccessEnum = builder.enumType('PublishAccess', { values: ['FULL', 'APPROVAL', 'NONE'] as const });
export const CommunityAccessEnum = builder.enumType('CommunityAccess', { values: ['FULL', 'VIEW', 'NONE'] as const });
export const CommentKindEnum = builder.enumType('CommentKind', { values: ['COMMENT', 'REPLY', 'MENTION', 'REVIEW', 'DM'] as const });
export const PlanEnum = builder.enumType('Plan', { values: ['FREE', 'ESSENTIALS', 'TEAM'] as const });
export const AutoRepostEnum = builder.enumType('AutoRepost', { values: ['OFF', 'ALWAYS', 'SMART'] as const });

export const MutationError = builder.objectRef<{ code: string; message: string; field?: string | null }>('MutationError').implement({
  fields: t => ({ code: t.exposeString('code'), message: t.exposeString('message'), field: t.exposeString('field', { nullable: true }) }),
});
export const AccountSummary = builder.objectRef<{ id: string; email: string; name: string | null; avatarUrl: string | null }>('AccountSummary').implement({
  fields: t => ({ id: t.exposeID('id'), email: t.exposeString('email'), name: t.exposeString('name', { nullable: true }), avatarUrl: t.exposeString('avatarUrl', { nullable: true }) }),
});
export const Issue = builder.objectRef<{ level: string; field: string; message: string }>('ValidationIssue').implement({
  fields: t => ({ level: t.exposeString('level'), field: t.exposeString('field'), message: t.exposeString('message') }),
});
