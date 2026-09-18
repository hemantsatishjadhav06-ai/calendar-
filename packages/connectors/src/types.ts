import type { Channel, PostTarget } from '@relay/db';
import type { NetworkRules } from '@relay/network-rules';
import type { Creds } from '@relay/token-vault';

export type { Creds };

export interface AuthStart { url: string; state: string; codeVerifier?: string; extra?: Record<string, any> }

export interface Candidate {
  externalId: string;
  subtype: string;
  displayName: string;
  handle?: string;
  avatarUrl?: string;
  meta?: Record<string, any>;
  /** Some grants yield per-candidate tokens (Facebook Page tokens). */
  credsOverride?: Partial<Creds>;
}
export interface AuthResult { creds: Creds; candidates: Candidate[] }

export interface MediaRef {
  assetId: string;
  kind: 'image' | 'gif' | 'video' | 'document';
  mime?: string;
  bytes?: number;
  width?: number;
  height?: number;
  durationMs?: number;
  altText?: string;
  userTags?: { username: string; x?: number; y?: number; id?: string }[];
  cover?: { offsetMs?: number; assetId?: string };
}

export interface PublishInput { target: PostTarget; channel: Channel; creds: Creds; idempotencyKey: string }
export interface PublishResult { externalId: string; url?: string; extra?: Record<string, any> }

export interface BudgetSpec { key: string; limit: number; windowSec: number; cost?: number }

export interface MetricsInput { channel: Channel; creds: Creds; since: Date; until: Date }
export interface ChannelMetricRow { day: string; metric: string; value: number }
export interface PostMetricRow { externalPostId: string; metric: string; value: number }
export interface AudienceRow { dimension: string; bucket: string; value: number }
export interface RecentPost { externalId: string; text?: string; url?: string; createdAt: Date; mediaUrl?: string }

export interface InboxItem {
  externalId: string;
  parentExternalId?: string;
  externalPostId?: string;
  kind: 'COMMENT' | 'REPLY' | 'MENTION' | 'REVIEW' | 'DM';
  author: { id?: string; name?: string; handle?: string; avatarUrl?: string };
  text: string;
  createdAt: Date;
  likeCount?: number;
  isHidden?: boolean;
  isOurs?: boolean;
  repliedAt?: Date;
  attachments?: any[];
  raw: any;
}

export interface WebhookReq { headers: Record<string, string>; rawBody: Buffer; query: Record<string, string> }
export interface WebhookEvent {
  externalChannelId: string;
  kind: 'inbox' | 'publish' | 'permissions' | 'story_insights' | 'media';
  items?: InboxItem[];
  raw: any;
}

export interface SocialConnector {
  network: Channel['network'];
  rules: NetworkRules;

  authStart(opts: { redirectUri: string; organizationId: string; hint?: string }): Promise<AuthStart>;
  authCallback(opts: { code: string; state: string; redirectUri: string; codeVerifier?: string; extra?: any }): Promise<AuthResult>;
  refresh(creds: Creds, channel: Channel): Promise<Creds>;
  health(creds: Creds, channel: Channel): Promise<{ ok: boolean; reason?: string; scopes?: string[] }>;
  revoke?(creds: Creds, channel: Channel): Promise<void>;
  /** Called once after a channel is connected (subscribe webhooks etc). */
  afterConnect?(creds: Creds, channel: Channel): Promise<void>;

  publishBudget(target: PostTarget, channel: Channel): BudgetSpec[];
  publish(input: PublishInput): Promise<PublishResult>;
  deletePost?(creds: Creds, channel: Channel, externalId: string): Promise<void>;

  collectChannelMetrics?(input: MetricsInput): Promise<ChannelMetricRow[]>;
  collectPostMetrics?(input: MetricsInput & { externalPostIds: string[] }): Promise<PostMetricRow[]>;
  collectAudience?(input: MetricsInput): Promise<AudienceRow[]>;
  listRecentPosts?(creds: Creds, channel: Channel, since: Date): Promise<RecentPost[]>;

  pollInbox?(creds: Creds, channel: Channel, cursor?: string): Promise<{ items: InboxItem[]; cursor?: string }>;
  reply?(creds: Creds, channel: Channel, item: { externalId: string; externalPostId?: string; parentExternalId?: string; raw?: any }, text: string): Promise<{ externalId: string }>;
  like?(creds: Creds, channel: Channel, item: { externalId: string; raw?: any }, reaction?: string): Promise<void>;
  hide?(creds: Creds, channel: Channel, item: { externalId: string }, hidden: boolean): Promise<void>;
  deleteComment?(creds: Creds, channel: Channel, item: { externalId: string; externalPostId?: string }): Promise<void>;

  verifyWebhook?(req: WebhookReq): { ok: boolean; challengeResponse?: string; contentType?: string };
  parseWebhook?(body: any): WebhookEvent[];

  /** Connector-specific lookups the composer needs (boards, creator info, locations…). */
  lookup?(creds: Creds, channel: Channel, what: string, args?: Record<string, any>): Promise<any>;
}
