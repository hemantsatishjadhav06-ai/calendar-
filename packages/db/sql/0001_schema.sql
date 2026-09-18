-- Relay schema (generated from Prisma DMMF, idempotent). Applied by scripts/release.mjs before RLS.
-- Generated from Prisma DMMF (sandbox schema-engine-free path). Not for production use.
DO $$ BEGIN CREATE TYPE "OrgRole" AS ENUM ('OWNER', 'ADMIN', 'MEMBER'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "PublishAccess" AS ENUM ('FULL', 'APPROVAL', 'NONE'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "CommunityAccess" AS ENUM ('FULL', 'VIEW', 'NONE'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "Network" AS ENUM ('FACEBOOK', 'INSTAGRAM', 'THREADS', 'X', 'LINKEDIN', 'TIKTOK', 'YOUTUBE', 'PINTEREST', 'GOOGLE_BUSINESS', 'BLUESKY', 'MASTODON', 'DEVTO', 'DISCORD', 'START_PAGE'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "ChannelStatus" AS ENUM ('ACTIVE', 'RECONNECT_REQUIRED', 'LOCKED', 'DISCONNECTED'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "PostStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'QUEUED', 'SCHEDULED', 'PUBLISHING', 'PUBLISHED', 'PARTIALLY_PUBLISHED', 'FAILED', 'NOTIFIED', 'CANCELLED'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "ScheduleMode" AS ENUM ('QUEUE', 'SHARE_NEXT', 'CUSTOM', 'NOW', 'DRAFT'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "SchedulingType" AS ENUM ('AUTOMATIC', 'NOTIFICATION'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "CommentKind" AS ENUM ('COMMENT', 'REPLY', 'MENTION', 'REVIEW', 'DM'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "Plan" AS ENUM ('FREE', 'ESSENTIALS', 'TEAM'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE "AutoRepost" AS ENUM ('OFF', 'ALWAYS', 'SMART'); EXCEPTION WHEN duplicate_object THEN null; END $$;
CREATE TABLE IF NOT EXISTS "Account" (
  "id" uuid NOT NULL DEFAULT uuid_generate_v7(),
  "email" text NOT NULL,
  "emailVerifiedAt" timestamp(3),
  "passwordHash" text,
  "name" text,
  "avatarUrl" text,
  "timezone" text NOT NULL DEFAULT 'UTC',
  "weekStartsOn" integer NOT NULL DEFAULT 1,
  "appearance" text NOT NULL DEFAULT 'system',
  "landingPage" text NOT NULL DEFAULT 'home',
  "defaultScheduleAction" text NOT NULL DEFAULT 'queue',
  "totpSecretEnc" bytea,
  "totpEnabledAt" timestamp(3),
  "recoveryCodesEnc" bytea,
  "lastOrganizationId" uuid,
  "createdAt" timestamp(3) NOT NULL DEFAULT now(),
  "updatedAt" timestamp(3) NOT NULL DEFAULT now(),
  PRIMARY KEY ("id"),
  UNIQUE ("email")
);
CREATE TABLE IF NOT EXISTS "OAuthIdentity" (
  "id" uuid NOT NULL DEFAULT uuid_generate_v7(),
  "accountId" uuid NOT NULL,
  "provider" text NOT NULL,
  "providerId" text NOT NULL,
  PRIMARY KEY ("id"),
  UNIQUE ("provider", "providerId")
);
CREATE TABLE IF NOT EXISTS "Session" (
  "id" text NOT NULL,
  "accountId" uuid NOT NULL,
  "expiresAt" timestamp(3) NOT NULL,
  "ip" text,
  "userAgent" text,
  "createdAt" timestamp(3) NOT NULL DEFAULT now(),
  PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS "Agency" (
  "id" uuid NOT NULL DEFAULT uuid_generate_v7(),
  "name" text NOT NULL,
  "createdAt" timestamp(3) NOT NULL DEFAULT now(),
  PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS "Organization" (
  "id" uuid NOT NULL DEFAULT uuid_generate_v7(),
  "name" text NOT NULL,
  "slug" text NOT NULL,
  "agencyId" uuid,
  "ownerAccountId" uuid NOT NULL,
  "require2fa" boolean NOT NULL DEFAULT false,
  "settings" jsonb NOT NULL DEFAULT '{}',
  "createdAt" timestamp(3) NOT NULL DEFAULT now(),
  "deletedAt" timestamp(3),
  PRIMARY KEY ("id"),
  UNIQUE ("slug")
);
CREATE TABLE IF NOT EXISTS "Membership" (
  "id" uuid NOT NULL DEFAULT uuid_generate_v7(),
  "accountId" uuid NOT NULL,
  "organizationId" uuid NOT NULL,
  "role" "OrgRole" NOT NULL DEFAULT 'MEMBER'::"OrgRole",
  "status" text NOT NULL DEFAULT 'ACTIVE',
  "invitedByAccountId" uuid,
  "invitedEmail" text,
  "inviteToken" text,
  "createdAt" timestamp(3) NOT NULL DEFAULT now(),
  PRIMARY KEY ("id"),
  UNIQUE ("inviteToken"),
  UNIQUE ("accountId", "organizationId")
);
CREATE TABLE IF NOT EXISTS "ChannelGrant" (
  "membershipId" uuid NOT NULL,
  "channelId" uuid NOT NULL,
  "publish" "PublishAccess" NOT NULL DEFAULT 'FULL'::"PublishAccess",
  "community" "CommunityAccess" NOT NULL DEFAULT 'FULL'::"CommunityAccess",
  PRIMARY KEY ("membershipId", "channelId")
);
CREATE TABLE IF NOT EXISTS "Channel" (
  "id" uuid NOT NULL DEFAULT uuid_generate_v7(),
  "organizationId" uuid NOT NULL,
  "network" "Network" NOT NULL,
  "subtype" text NOT NULL,
  "externalId" text NOT NULL,
  "displayName" text NOT NULL,
  "handle" text,
  "avatarUrl" text,
  "timezone" text NOT NULL DEFAULT 'UTC',
  "status" "ChannelStatus" NOT NULL DEFAULT 'ACTIVE'::"ChannelStatus",
  "statusReason" text,
  "isPaused" boolean NOT NULL DEFAULT false,
  "notifyByDefault" boolean NOT NULL DEFAULT false,
  "postingGoalPerWeek" integer,
  "sortOrder" integer NOT NULL DEFAULT 0,
  "meta" jsonb NOT NULL DEFAULT '{}',
  "connectedByAccountId" uuid NOT NULL,
  "connectedAt" timestamp(3) NOT NULL DEFAULT now(),
  "lastHealthCheckAt" timestamp(3),
  "inboxCursor" text,
  "metricsCursor" timestamp(3),
  "deletedAt" timestamp(3),
  PRIMARY KEY ("id"),
  UNIQUE ("organizationId", "network", "externalId")
);
CREATE TABLE IF NOT EXISTS "ChannelCredential" (
  "channelId" uuid NOT NULL,
  "accessTokenEnc" bytea NOT NULL,
  "refreshTokenEnc" bytea,
  "extraEnc" bytea NOT NULL,
  "dekEnc" bytea NOT NULL,
  "tokenType" text NOT NULL DEFAULT 'bearer',
  "scopes" text[] NOT NULL DEFAULT '{}',
  "accessExpiresAt" timestamp(3),
  "refreshExpiresAt" timestamp(3),
  "lastRefreshedAt" timestamp(3),
  "refreshFailures" integer NOT NULL DEFAULT 0,
  "updatedAt" timestamp(3) NOT NULL DEFAULT now(),
  PRIMARY KEY ("channelId")
);
CREATE TABLE IF NOT EXISTS "ChannelGroup" (
  "id" uuid NOT NULL DEFAULT uuid_generate_v7(),
  "organizationId" uuid NOT NULL,
  "name" text NOT NULL,
  PRIMARY KEY ("id"),
  UNIQUE ("organizationId", "name")
);
CREATE TABLE IF NOT EXISTS "ChannelGroupMember" (
  "groupId" uuid NOT NULL,
  "channelId" uuid NOT NULL,
  PRIMARY KEY ("groupId", "channelId")
);
CREATE TABLE IF NOT EXISTS "PostingSlot" (
  "id" uuid NOT NULL DEFAULT uuid_generate_v7(),
  "channelId" uuid NOT NULL,
  "weekday" integer NOT NULL,
  "minuteOfDay" integer NOT NULL,
  "enabled" boolean NOT NULL DEFAULT true,
  "source" text NOT NULL DEFAULT 'manual',
  PRIMARY KEY ("id"),
  UNIQUE ("channelId", "weekday", "minuteOfDay")
);
CREATE TABLE IF NOT EXISTS "Post" (
  "id" uuid NOT NULL DEFAULT uuid_generate_v7(),
  "organizationId" uuid NOT NULL,
  "createdByAccountId" uuid NOT NULL,
  "status" "PostStatus" NOT NULL DEFAULT 'DRAFT'::"PostStatus",
  "scheduleMode" "ScheduleMode" NOT NULL DEFAULT 'QUEUE'::"ScheduleMode",
  "baseText" text NOT NULL DEFAULT '',
  "baseMedia" jsonb NOT NULL DEFAULT '[]',
  "linkPreview" jsonb,
  "ideaId" uuid,
  "templateId" uuid,
  "aiAssisted" boolean NOT NULL DEFAULT false,
  "autoRepost" "AutoRepost" NOT NULL DEFAULT 'OFF'::"AutoRepost",
  "boostedAt" timestamp(3),
  "createdAt" timestamp(3) NOT NULL DEFAULT now(),
  "updatedAt" timestamp(3) NOT NULL DEFAULT now(),
  "deletedAt" timestamp(3),
  PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS "PostTarget" (
  "id" uuid NOT NULL DEFAULT uuid_generate_v7(),
  "organizationId" uuid NOT NULL,
  "postId" uuid NOT NULL,
  "channelId" uuid NOT NULL,
  "status" "PostStatus" NOT NULL DEFAULT 'QUEUED'::"PostStatus",
  "schedulingType" "SchedulingType" NOT NULL DEFAULT 'AUTOMATIC'::"SchedulingType",
  "isCustomTime" boolean NOT NULL DEFAULT false,
  "dueAt" timestamp(3),
  "queuePosition" integer,
  "customized" boolean NOT NULL DEFAULT false,
  "text" text NOT NULL DEFAULT '',
  "media" jsonb NOT NULL DEFAULT '[]',
  "thread" jsonb NOT NULL DEFAULT '[]',
  "firstComment" text,
  "metadata" jsonb NOT NULL DEFAULT '{}',
  "shortLinks" jsonb NOT NULL DEFAULT '[]',
  "linkPreviewUrl" text,
  "attemptCount" integer NOT NULL DEFAULT 0,
  "lastAttemptAt" timestamp(3),
  "lockedBy" text,
  "lockedAt" timestamp(3),
  "externalPostId" text,
  "externalUrl" text,
  "publishedAt" timestamp(3),
  "failureCode" text,
  "failureMessage" text,
  "createdAt" timestamp(3) NOT NULL DEFAULT now(),
  "updatedAt" timestamp(3) NOT NULL DEFAULT now(),
  PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS "NotificationJob" (
  "postTargetId" uuid NOT NULL,
  "sentAt" timestamp(3),
  "resentAt" timestamp(3),
  "openedAt" timestamp(3),
  "completedAt" timestamp(3),
  PRIMARY KEY ("postTargetId")
);
CREATE TABLE IF NOT EXISTS "Approval" (
  "postId" uuid NOT NULL,
  "requestedByAccountId" uuid NOT NULL,
  "requestedAt" timestamp(3) NOT NULL DEFAULT now(),
  "decidedByAccountId" uuid,
  "decidedAt" timestamp(3),
  "decision" text,
  "reason" text,
  PRIMARY KEY ("postId")
);
CREATE TABLE IF NOT EXISTS "Note" (
  "id" uuid NOT NULL DEFAULT uuid_generate_v7(),
  "organizationId" uuid NOT NULL,
  "postId" uuid NOT NULL,
  "authorAccountId" uuid NOT NULL,
  "body" text NOT NULL,
  "createdAt" timestamp(3) NOT NULL DEFAULT now(),
  "editedAt" timestamp(3),
  "deletedAt" timestamp(3),
  PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS "Tag" (
  "id" uuid NOT NULL DEFAULT uuid_generate_v7(),
  "organizationId" uuid NOT NULL,
  "name" text NOT NULL,
  "color" text NOT NULL,
  PRIMARY KEY ("id"),
  UNIQUE ("organizationId", "name")
);
CREATE TABLE IF NOT EXISTS "PostTag" (
  "postId" uuid NOT NULL,
  "tagId" uuid NOT NULL,
  PRIMARY KEY ("postId", "tagId")
);
CREATE TABLE IF NOT EXISTS "HashtagGroup" (
  "id" uuid NOT NULL DEFAULT uuid_generate_v7(),
  "organizationId" uuid NOT NULL,
  "name" text NOT NULL,
  "hashtags" text[] NOT NULL DEFAULT '{}',
  PRIMARY KEY ("id"),
  UNIQUE ("organizationId", "name")
);
CREATE TABLE IF NOT EXISTS "Template" (
  "id" uuid NOT NULL DEFAULT uuid_generate_v7(),
  "organizationId" uuid,
  "ownerAccountId" uuid,
  "title" text NOT NULL,
  "body" text NOT NULL,
  "category" text,
  "isLibrary" boolean NOT NULL DEFAULT false,
  "createdAt" timestamp(3) NOT NULL DEFAULT now(),
  PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS "IdeaGroup" (
  "id" uuid NOT NULL DEFAULT uuid_generate_v7(),
  "organizationId" uuid NOT NULL,
  "name" text NOT NULL,
  "sortOrder" integer NOT NULL DEFAULT 0,
  PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS "Idea" (
  "id" uuid NOT NULL DEFAULT uuid_generate_v7(),
  "organizationId" uuid NOT NULL,
  "groupId" uuid,
  "createdByAccountId" uuid NOT NULL,
  "title" text,
  "body" text NOT NULL DEFAULT '',
  "media" jsonb NOT NULL DEFAULT '[]',
  "links" jsonb NOT NULL DEFAULT '[]',
  "sortOrder" integer NOT NULL DEFAULT 0,
  "aiGenerated" boolean NOT NULL DEFAULT false,
  "usedAt" timestamp(3),
  "createdAt" timestamp(3) NOT NULL DEFAULT now(),
  "updatedAt" timestamp(3) NOT NULL DEFAULT now(),
  "deletedAt" timestamp(3),
  PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS "IdeaTag" (
  "ideaId" uuid NOT NULL,
  "tagId" uuid NOT NULL,
  PRIMARY KEY ("ideaId", "tagId")
);
CREATE TABLE IF NOT EXISTS "Asset" (
  "id" uuid NOT NULL DEFAULT uuid_generate_v7(),
  "organizationId" uuid NOT NULL,
  "uploadedByAccountId" uuid NOT NULL,
  "kind" text NOT NULL,
  "originalKey" text NOT NULL,
  "mime" text NOT NULL,
  "bytes" integer NOT NULL,
  "width" integer,
  "height" integer,
  "durationMs" integer,
  "fps" double precision,
  "codec" text,
  "sha256" text NOT NULL,
  "altTextDefault" text,
  "source" text NOT NULL DEFAULT 'upload',
  "sourceMeta" jsonb NOT NULL DEFAULT '{}',
  "renditions" jsonb NOT NULL DEFAULT '{}',
  "status" text NOT NULL DEFAULT 'uploading',
  "error" text,
  "createdAt" timestamp(3) NOT NULL DEFAULT now(),
  PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS "ShortLink" (
  "id" uuid NOT NULL DEFAULT uuid_generate_v7(),
  "organizationId" uuid NOT NULL,
  "slug" text NOT NULL,
  "targetUrl" text NOT NULL,
  "postTargetId" uuid,
  "provider" text NOT NULL DEFAULT 'relay',
  "createdAt" timestamp(3) NOT NULL DEFAULT now(),
  PRIMARY KEY ("id"),
  UNIQUE ("slug")
);
CREATE TABLE IF NOT EXISTS "ChannelMetricDaily" (
  "channelId" uuid NOT NULL,
  "day" date NOT NULL,
  "metric" text NOT NULL,
  "value" double precision NOT NULL,
  "source" text NOT NULL DEFAULT 'api',
  PRIMARY KEY ("channelId", "day", "metric")
);
CREATE TABLE IF NOT EXISTS "PostMetric" (
  "postTargetId" uuid NOT NULL,
  "capturedAt" timestamp(3) NOT NULL,
  "metric" text NOT NULL,
  "value" double precision NOT NULL,
  PRIMARY KEY ("postTargetId", "capturedAt", "metric")
);
CREATE TABLE IF NOT EXISTS "AudienceSnapshot" (
  "channelId" uuid NOT NULL,
  "day" date NOT NULL,
  "dimension" text NOT NULL,
  "bucket" text NOT NULL,
  "value" double precision NOT NULL,
  PRIMARY KEY ("channelId", "day", "dimension", "bucket")
);
CREATE TABLE IF NOT EXISTS "Report" (
  "id" uuid NOT NULL DEFAULT uuid_generate_v7(),
  "organizationId" uuid NOT NULL,
  "name" text NOT NULL,
  "description" text,
  "logoAssetId" uuid,
  "charts" jsonb NOT NULL DEFAULT '[]',
  "createdByAccountId" uuid NOT NULL,
  "createdAt" timestamp(3) NOT NULL DEFAULT now(),
  "updatedAt" timestamp(3) NOT NULL DEFAULT now(),
  PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS "Comment" (
  "id" uuid NOT NULL DEFAULT uuid_generate_v7(),
  "organizationId" uuid NOT NULL,
  "channelId" uuid NOT NULL,
  "postTargetId" uuid,
  "externalPostId" text,
  "externalId" text NOT NULL,
  "parentExternalId" text,
  "kind" "CommentKind" NOT NULL DEFAULT 'COMMENT'::"CommentKind",
  "authorExternalId" text,
  "authorName" text,
  "authorHandle" text,
  "authorAvatarUrl" text,
  "text" text NOT NULL,
  "attachments" jsonb NOT NULL DEFAULT '[]',
  "externalCreatedAt" timestamp(3) NOT NULL,
  "likeCount" integer NOT NULL DEFAULT 0,
  "isHidden" boolean NOT NULL DEFAULT false,
  "isDeleted" boolean NOT NULL DEFAULT false,
  "isOurs" boolean NOT NULL DEFAULT false,
  "repliedAt" timestamp(3),
  "resolvedAt" timestamp(3),
  "resolvedByAccountId" uuid,
  "assignedToAccountId" uuid,
  "labels" text[] NOT NULL DEFAULT '{}',
  "sentiment" double precision,
  "triage" text,
  "raw" jsonb NOT NULL,
  "createdAt" timestamp(3) NOT NULL DEFAULT now(),
  PRIMARY KEY ("id"),
  UNIQUE ("channelId", "externalId")
);
CREATE TABLE IF NOT EXISTS "SavedReply" (
  "id" uuid NOT NULL DEFAULT uuid_generate_v7(),
  "organizationId" uuid NOT NULL,
  "title" text NOT NULL,
  "body" text NOT NULL,
  "createdAt" timestamp(3) NOT NULL DEFAULT now(),
  PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS "SavedView" (
  "id" uuid NOT NULL DEFAULT uuid_generate_v7(),
  "organizationId" uuid NOT NULL,
  "accountId" uuid NOT NULL,
  "area" text NOT NULL,
  "name" text NOT NULL,
  "filters" jsonb NOT NULL,
  "sortOrder" integer NOT NULL DEFAULT 0,
  PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS "StartPage" (
  "id" uuid NOT NULL DEFAULT uuid_generate_v7(),
  "organizationId" uuid NOT NULL,
  "slug" text NOT NULL,
  "nickname" text NOT NULL,
  "theme" jsonb NOT NULL,
  "header" jsonb NOT NULL,
  "blocks" jsonb NOT NULL DEFAULT '[]',
  "publishedRevision" jsonb,
  "publishedAt" timestamp(3),
  "createdAt" timestamp(3) NOT NULL DEFAULT now(),
  "updatedAt" timestamp(3) NOT NULL DEFAULT now(),
  PRIMARY KEY ("id"),
  UNIQUE ("slug")
);
CREATE TABLE IF NOT EXISTS "Subscription" (
  "organizationId" uuid NOT NULL,
  "plan" "Plan" NOT NULL DEFAULT 'FREE'::"Plan",
  "interval" text NOT NULL DEFAULT 'month',
  "stripeCustomerId" text,
  "stripeSubscriptionId" text,
  "stripePriceId" text,
  "channelQuantity" integer NOT NULL DEFAULT 3,
  "pendingQuantity" integer,
  "status" text NOT NULL DEFAULT 'active',
  "trialEndsAt" timestamp(3),
  "currentPeriodEnd" timestamp(3),
  "cancelAtPeriodEnd" boolean NOT NULL DEFAULT false,
  "updatedAt" timestamp(3) NOT NULL DEFAULT now(),
  PRIMARY KEY ("organizationId"),
  UNIQUE ("stripeCustomerId"),
  UNIQUE ("stripeSubscriptionId")
);
CREATE TABLE IF NOT EXISTS "ApiKey" (
  "id" uuid NOT NULL DEFAULT uuid_generate_v7(),
  "accountId" uuid NOT NULL,
  "organizationId" uuid NOT NULL,
  "name" text NOT NULL,
  "prefix" text NOT NULL,
  "hash" text NOT NULL,
  "scopes" text[] NOT NULL DEFAULT '{}',
  "lastUsedAt" timestamp(3),
  "revokedAt" timestamp(3),
  "createdAt" timestamp(3) NOT NULL DEFAULT now(),
  PRIMARY KEY ("id"),
  UNIQUE ("hash")
);
CREATE TABLE IF NOT EXISTS "OAuthClient" (
  "id" uuid NOT NULL DEFAULT uuid_generate_v7(),
  "organizationId" uuid NOT NULL,
  "name" text NOT NULL,
  "clientId" text NOT NULL,
  "clientSecretHash" text,
  "redirectUris" text[] NOT NULL DEFAULT '{}',
  "scopes" text[] NOT NULL DEFAULT '{}',
  "isPublic" boolean NOT NULL DEFAULT true,
  "createdAt" timestamp(3) NOT NULL DEFAULT now(),
  PRIMARY KEY ("id"),
  UNIQUE ("clientId")
);
CREATE TABLE IF NOT EXISTS "OAuthGrant" (
  "id" uuid NOT NULL DEFAULT uuid_generate_v7(),
  "clientId" uuid NOT NULL,
  "accountId" uuid NOT NULL,
  "organizationId" uuid NOT NULL,
  "scopes" text[] NOT NULL DEFAULT '{}',
  "refreshTokenHash" text,
  "refreshExpiresAt" timestamp(3),
  "revokedAt" timestamp(3),
  "createdAt" timestamp(3) NOT NULL DEFAULT now(),
  PRIMARY KEY ("id"),
  UNIQUE ("refreshTokenHash")
);
CREATE TABLE IF NOT EXISTS "Integration" (
  "id" uuid NOT NULL DEFAULT uuid_generate_v7(),
  "organizationId" uuid NOT NULL,
  "provider" text NOT NULL,
  "credentialEnc" bytea NOT NULL,
  "dekEnc" bytea NOT NULL,
  "meta" jsonb NOT NULL DEFAULT '{}',
  "createdAt" timestamp(3) NOT NULL DEFAULT now(),
  PRIMARY KEY ("id"),
  UNIQUE ("organizationId", "provider")
);
CREATE TABLE IF NOT EXISTS "MastodonApp" (
  "host" text NOT NULL,
  "clientId" text NOT NULL,
  "clientSecret" text NOT NULL,
  "createdAt" timestamp(3) NOT NULL DEFAULT now(),
  PRIMARY KEY ("host")
);
CREATE TABLE IF NOT EXISTS "FeatureFlag" (
  "organizationId" uuid NOT NULL,
  "key" text NOT NULL,
  "enabled" boolean NOT NULL,
  PRIMARY KEY ("organizationId", "key")
);
CREATE TABLE IF NOT EXISTS "NotificationPref" (
  "accountId" uuid NOT NULL,
  "key" text NOT NULL,
  "enabled" boolean NOT NULL DEFAULT true,
  PRIMARY KEY ("accountId", "key")
);
CREATE TABLE IF NOT EXISTS "SavedMention" (
  "id" uuid NOT NULL DEFAULT uuid_generate_v7(),
  "organizationId" uuid NOT NULL,
  "label" text NOT NULL,
  "value" text NOT NULL,
  "network" text,
  "createdAt" timestamp(3) NOT NULL DEFAULT now(),
  PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "SavedMention_organizationId_idx" ON "SavedMention" ("organizationId");
CREATE TABLE IF NOT EXISTS "CalendarEvent" (
  "id" uuid NOT NULL DEFAULT uuid_generate_v7(),
  "organizationId" uuid NOT NULL,
  "title" text NOT NULL,
  "startDate" date NOT NULL,
  "endDate" date NOT NULL,
  "color" text NOT NULL DEFAULT '#F79009',
  "note" text,
  "createdByAccountId" uuid NOT NULL,
  "createdAt" timestamp(3) NOT NULL DEFAULT now(),
  PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "CalendarEvent_organizationId_startDate_idx" ON "CalendarEvent" ("organizationId", "startDate");
CREATE TABLE IF NOT EXISTS "Notification" (
  "id" uuid NOT NULL DEFAULT uuid_generate_v7(),
  "organizationId" uuid NOT NULL,
  "accountId" uuid NOT NULL,
  "type" text NOT NULL,
  "title" text NOT NULL,
  "body" text,
  "url" text,
  "data" jsonb NOT NULL DEFAULT '{}',
  "readAt" timestamp(3),
  "createdAt" timestamp(3) NOT NULL DEFAULT now(),
  PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "Notification_accountId_readAt_createdAt_idx" ON "Notification" ("accountId", "readAt", "createdAt");
CREATE INDEX IF NOT EXISTS "Notification_organizationId_idx" ON "Notification" ("organizationId");
CREATE TABLE IF NOT EXISTS "AuditLog" (
  "id" bigserial NOT NULL,
  "organizationId" uuid NOT NULL,
  "actorAccountId" uuid,
  "action" text NOT NULL,
  "entity" text NOT NULL,
  "entityId" text,
  "diff" jsonb,
  "ip" text,
  "createdAt" timestamp(3) NOT NULL DEFAULT now(),
  PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS "WebhookInbox" (
  "id" bigserial NOT NULL,
  "provider" text NOT NULL,
  "eventId" text NOT NULL,
  "receivedAt" timestamp(3) NOT NULL DEFAULT now(),
  "processedAt" timestamp(3),
  "error" text,
  "payload" jsonb NOT NULL,
  "signatureOk" boolean NOT NULL,
  PRIMARY KEY ("id"),
  UNIQUE ("provider", "eventId")
);
CREATE TABLE IF NOT EXISTS "AiUsage" (
  "id" bigserial NOT NULL,
  "organizationId" uuid NOT NULL,
  "accountId" uuid NOT NULL,
  "feature" text NOT NULL,
  "model" text NOT NULL,
  "promptTokens" integer NOT NULL,
  "completionTokens" integer NOT NULL,
  "costUsd" decimal(10,6) NOT NULL,
  "createdAt" timestamp(3) NOT NULL DEFAULT now(),
  PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS "SpendLedger" (
  "id" bigserial NOT NULL,
  "organizationId" uuid NOT NULL,
  "provider" text NOT NULL,
  "amountUsd" decimal(10,4) NOT NULL,
  "ref" text,
  "createdAt" timestamp(3) NOT NULL DEFAULT now(),
  PRIMARY KEY ("id")
);
-- foreign keys
DO $$ BEGIN ALTER TABLE "OAuthIdentity" ADD CONSTRAINT "OAuthIdentity_account_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "Session" ADD CONSTRAINT "Session_account_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "Organization" ADD CONSTRAINT "Organization_agency_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency" ("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "Membership" ADD CONSTRAINT "Membership_account_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "Membership" ADD CONSTRAINT "Membership_organization_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "ChannelGrant" ADD CONSTRAINT "ChannelGrant_membership_fkey" FOREIGN KEY ("membershipId") REFERENCES "Membership" ("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "ChannelGrant" ADD CONSTRAINT "ChannelGrant_channel_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel" ("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "Channel" ADD CONSTRAINT "Channel_organization_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "ChannelCredential" ADD CONSTRAINT "ChannelCredential_channel_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel" ("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "ChannelGroup" ADD CONSTRAINT "ChannelGroup_organization_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "ChannelGroupMember" ADD CONSTRAINT "ChannelGroupMember_group_fkey" FOREIGN KEY ("groupId") REFERENCES "ChannelGroup" ("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "ChannelGroupMember" ADD CONSTRAINT "ChannelGroupMember_channel_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel" ("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "PostingSlot" ADD CONSTRAINT "PostingSlot_channel_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel" ("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "Post" ADD CONSTRAINT "Post_organization_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "PostTarget" ADD CONSTRAINT "PostTarget_post_fkey" FOREIGN KEY ("postId") REFERENCES "Post" ("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "PostTarget" ADD CONSTRAINT "PostTarget_channel_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel" ("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "NotificationJob" ADD CONSTRAINT "NotificationJob_postTarget_fkey" FOREIGN KEY ("postTargetId") REFERENCES "PostTarget" ("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "Approval" ADD CONSTRAINT "Approval_post_fkey" FOREIGN KEY ("postId") REFERENCES "Post" ("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "Note" ADD CONSTRAINT "Note_organization_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "Note" ADD CONSTRAINT "Note_post_fkey" FOREIGN KEY ("postId") REFERENCES "Post" ("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "Tag" ADD CONSTRAINT "Tag_organization_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "PostTag" ADD CONSTRAINT "PostTag_post_fkey" FOREIGN KEY ("postId") REFERENCES "Post" ("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "PostTag" ADD CONSTRAINT "PostTag_tag_fkey" FOREIGN KEY ("tagId") REFERENCES "Tag" ("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "HashtagGroup" ADD CONSTRAINT "HashtagGroup_organization_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "Template" ADD CONSTRAINT "Template_organization_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "IdeaGroup" ADD CONSTRAINT "IdeaGroup_organization_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "Idea" ADD CONSTRAINT "Idea_organization_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "Idea" ADD CONSTRAINT "Idea_group_fkey" FOREIGN KEY ("groupId") REFERENCES "IdeaGroup" ("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "IdeaTag" ADD CONSTRAINT "IdeaTag_idea_fkey" FOREIGN KEY ("ideaId") REFERENCES "Idea" ("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "IdeaTag" ADD CONSTRAINT "IdeaTag_tag_fkey" FOREIGN KEY ("tagId") REFERENCES "Tag" ("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "Asset" ADD CONSTRAINT "Asset_organization_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "ShortLink" ADD CONSTRAINT "ShortLink_organization_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "ChannelMetricDaily" ADD CONSTRAINT "ChannelMetricDaily_channel_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel" ("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "PostMetric" ADD CONSTRAINT "PostMetric_postTarget_fkey" FOREIGN KEY ("postTargetId") REFERENCES "PostTarget" ("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "Report" ADD CONSTRAINT "Report_organization_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "Comment" ADD CONSTRAINT "Comment_organization_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "Comment" ADD CONSTRAINT "Comment_channel_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel" ("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "Comment" ADD CONSTRAINT "Comment_postTarget_fkey" FOREIGN KEY ("postTargetId") REFERENCES "PostTarget" ("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "SavedReply" ADD CONSTRAINT "SavedReply_organization_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "SavedView" ADD CONSTRAINT "SavedView_organization_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "StartPage" ADD CONSTRAINT "StartPage_organization_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_organization_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "ApiKey" ADD CONSTRAINT "ApiKey_account_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "ApiKey" ADD CONSTRAINT "ApiKey_organization_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "OAuthClient" ADD CONSTRAINT "OAuthClient_organization_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "OAuthGrant" ADD CONSTRAINT "OAuthGrant_client_fkey" FOREIGN KEY ("clientId") REFERENCES "OAuthClient" ("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "Integration" ADD CONSTRAINT "Integration_organization_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "FeatureFlag" ADD CONSTRAINT "FeatureFlag_organization_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "NotificationPref" ADD CONSTRAINT "NotificationPref_account_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_organization_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN null; END $$;

