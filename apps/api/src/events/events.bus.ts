import { Redis } from 'ioredis';
import { env } from '@relay/config';

export type RelayEvent =
  | { type: 'target.published'; targetId: string; url?: string }
  | { type: 'target.failed'; targetId: string; code: string; message?: string }
  | { type: 'target.updated'; targetId: string }
  | { type: 'queue.changed'; channelId: string }
  | { type: 'channel.updated'; channelId: string }
  | { type: 'comment.new'; commentId: string; channelId: string }
  | { type: 'comment.updated'; commentId: string }
  | { type: 'approval.requested'; postId: string }
  | { type: 'asset.ready'; assetId: string }
  | { type: 'asset.failed'; assetId: string; error: string };

let pub: Redis | undefined;
const publisher = () => (pub ??= new Redis(env.REDIS_URL, { maxRetriesPerRequest: null }));

/** Org-scoped event bus over Redis pub/sub; API fans out to SSE clients, workers publish. */
export const events = {
  channel: (organizationId: string) => `events:${organizationId}`,
  publish(organizationId: string, e: RelayEvent) {
    publisher().publish(this.channel(organizationId), JSON.stringify({ ...e, at: Date.now() })).catch(() => undefined);
  },
};
