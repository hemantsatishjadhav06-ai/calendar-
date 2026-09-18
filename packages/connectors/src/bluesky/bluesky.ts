import { NodeOAuthClient, type NodeSavedSession, type NodeSavedState } from '@atproto/oauth-client-node';
import { Agent, RichText, type AppBskyFeedPost, type AppBskyEmbedImages, type AppBskyEmbedExternal, type AppBskyEmbedVideo } from '@atproto/api';
import { JoseKey } from '@atproto/jwk-jose';
import { Redis } from 'ioredis';
import { env } from '@relay/config';
import { blueskyRules } from '@relay/network-rules';
import { tokenVault, type Creds } from '@relay/token-vault';
import type { SocialConnector, MediaRef, InboxItem } from '../types.js';
import { ConnectorError, http, readJson, streamFromS3, sleep, chunks, newState, assertConfigured } from '../shared/index.js';

const SCOPE = 'atproto repo:app.bsky.feed.post repo:app.bsky.feed.like repo:app.bsky.feed.repost repo:app.bsky.feed.threadgate repo:app.bsky.feed.postgate blob:image/* blob:video/mp4 rpc:app.bsky.video.uploadVideo?aud=did:web:video.bsky.app rpc:app.bsky.video.getUploadLimits?aud=did:web:video.bsky.app rpc:*?aud=did:web:api.bsky.app#bsky_appview';
interface Part { text: string; media: MediaRef[] }

let redis: Redis | undefined; const r = () => (redis ??= new Redis(env.REDIS_URL, { maxRetriesPerRequest: null }));
let client: NodeOAuthClient | undefined;

export async function bskyClient() {
  if (client) return client;
  assertConfigured(['BSKY_PRIVATE_KEY_1', env.BSKY_PRIVATE_KEY_1]);
  client = new NodeOAuthClient({
    clientMetadata: {
      client_id: `${env.APP_URL}/oauth/bluesky/client-metadata.json`, client_name: 'Relay', client_uri: env.APP_URL, logo_uri: `${env.APP_URL}/logo.png`, tos_uri: `${env.APP_URL}/terms`, policy_uri: `${env.APP_URL}/privacy`,
      redirect_uris: [`${env.API_URL}/oauth/BLUESKY/callback`], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], scope: SCOPE, application_type: 'web',
      token_endpoint_auth_method: 'private_key_jwt', token_endpoint_auth_signing_alg: 'ES256', dpop_bound_access_tokens: true, jwks_uri: `${env.APP_URL}/oauth/bluesky/jwks.json`,
    },
    keyset: [await JoseKey.fromImportable(env.BSKY_PRIVATE_KEY_1!, 'key1')],
    stateStore: { set: async (k, v: NodeSavedState) => { await r().setex(`bsky:state:${k}`, 600, JSON.stringify(v)); }, get: async k => { const v = await r().get(`bsky:state:${k}`); return v ? JSON.parse(v) : undefined; }, del: async k => { await r().del(`bsky:state:${k}`); } },
    sessionStore: { set: async (did, s: NodeSavedSession) => tokenVault.storeRaw(`bsky:${did}`, JSON.stringify(s)), get: async did => { const v = await tokenVault.loadRaw(`bsky:${did}`); return v ? JSON.parse(v) : undefined; }, del: async did => tokenVault.deleteRaw(`bsky:${did}`) },
  });
  return client;
}
export async function clientMetadata() { return (await bskyClient()).clientMetadata; }
export async function jwks() { return (await bskyClient()).jwks; }

async function agentFor(creds: Creds) { const c = await bskyClient(); const session = await c.restore(creds.extra.did); return new Agent(session); }

export const bluesky: SocialConnector = {
  network: 'BLUESKY',
  rules: blueskyRules,

  async authStart({ hint }) {
    const c = await bskyClient(); const state = newState();
    const url = await c.authorize((hint ?? 'bsky.social').replace(/^@/, ''), { state, scope: SCOPE });
    return { url: url.toString(), state };
  },
  async authCallback({ code, state, extra }) {
    const c = await bskyClient();
    const { session } = await c.callback(new URLSearchParams({ code, state, ...(extra?.iss ? { iss: extra.iss } : {}) }));
    const agent = new Agent(session); const prof = await agent.getProfile({ actor: session.did });
    return { creds: { accessToken: 'oauth-session', tokenType: 'oauth-session', scopes: SCOPE.split(' '), extra: { did: session.did } }, candidates: [{ externalId: session.did, subtype: 'profile', displayName: prof.data.displayName ?? prof.data.handle, handle: prof.data.handle, avatarUrl: prof.data.avatar }] };
  },
  async refresh(creds) { return creds; },   // @atproto/oauth-client-node refreshes via sessionStore
  async health(creds) { try { const a = await agentFor(creds); await a.getProfile({ actor: creds.extra.did }); return { ok: true }; } catch (e: any) { return { ok: false, reason: e.message }; } },
  publishBudget(target) { const n = 1 + (((target.thread as any[]) ?? []).length); return [{ key: `bsky:${target.channelId}:writes`, limit: 1600, windowSec: 3600, cost: n }]; },

  async publish({ target, creds }) {
    const agent = await agentFor(creds); const did: string = creds.extra.did; const md = (target.metadata ?? {}) as any;
    const parts: Part[] = [{ text: target.text, media: (target.media as unknown as MediaRef[]) ?? [] }, ...(((target.thread as any[]) ?? []) as Part[])];
    let root: { uri: string; cid: string } | undefined, parent: { uri: string; cid: string } | undefined;
    for (const [i, p] of parts.entries()) {
      const rt = new RichText({ text: p.text }); await rt.detectFacets(agent);
      if (rt.graphemeLength > 300) throw new ConnectorError('VALIDATION', `Bluesky post ${i + 1} exceeds 300 characters`, { retryable: false });
      const record: AppBskyFeedPost.Record = { $type: 'app.bsky.feed.post', text: rt.text, facets: rt.facets, createdAt: new Date().toISOString(), langs: md.langs ?? ['en'] };
      if (p.media[0]?.kind === 'video') record.embed = await embedVideo(agent, did, p.media[0]);
      else if (p.media.length) record.embed = await embedImages(agent, p.media.slice(0, 4));
      else if (i === 0 && target.linkPreviewUrl) record.embed = await embedExternal(agent, target.linkPreviewUrl, (target as any).post?.linkPreview);
      if (parent && root) record.reply = { root, parent };
      if (md.selfLabels?.length) record.labels = { $type: 'com.atproto.label.defs#selfLabels', values: md.selfLabels.map((val: string) => ({ val })) };
      const res = await agent.post(record);
      if (i === 0) {
        root = res;
        if (md.replyControl && md.replyControl !== 'everyone') {
          const rkey = res.uri.split('/').pop()!;
          const allow = md.replyControl === 'nobody' ? [] : [{ $type: `app.bsky.feed.threadgate#${md.replyControl}Rule` }];
          await agent.api.app.bsky.feed.threadgate.create({ repo: did, rkey }, { post: res.uri, allow: allow as any, createdAt: new Date().toISOString() }).catch(() => undefined);
        }
      }
      parent = res;
    }
    const rkey = root!.uri.split('/').pop();
    return { externalId: root!.uri, url: `https://bsky.app/profile/${did}/post/${rkey}`, extra: { cid: root!.cid } };
  },
  async deletePost(creds, _ch, uri) { const a = await agentFor(creds); await a.deletePost(uri); },
  async collectPostMetrics({ creds, externalPostIds }) {
    const a = await agentFor(creds); const out: { externalPostId: string; metric: string; value: number }[] = [];
    for (const chunk of chunks(externalPostIds, 25)) {
      const res = await a.getPosts({ uris: chunk }).catch(() => ({ data: { posts: [] } }));
      for (const p of res.data.posts) out.push({ externalPostId: p.uri, metric: 'likes', value: p.likeCount ?? 0 }, { externalPostId: p.uri, metric: 'comments', value: p.replyCount ?? 0 }, { externalPostId: p.uri, metric: 'shares', value: p.repostCount ?? 0 }, { externalPostId: p.uri, metric: 'quotes', value: p.quoteCount ?? 0 });
    }
    return out;
  },
  async collectChannelMetrics({ creds, until }) { const a = await agentFor(creds); const p = await a.getProfile({ actor: creds.extra.did }); const d = until.toISOString().slice(0, 10); return [{ day: d, metric: 'followers', value: p.data.followersCount ?? 0 }, { day: d, metric: 'posts_total', value: p.data.postsCount ?? 0 }]; },
  async listRecentPosts(creds, channel, since) {
    const a = await agentFor(creds); const res = await a.getAuthorFeed({ actor: creds.extra.did, limit: 50, filter: 'posts_no_replies' }).catch(() => ({ data: { feed: [] } }));
    return res.data.feed.filter(f => Date.parse(f.post.indexedAt) >= since.getTime()).map(f => ({ externalId: f.post.uri, text: (f.post.record as any).text, url: `https://bsky.app/profile/${channel.handle}/post/${f.post.uri.split('/').pop()}`, createdAt: new Date(f.post.indexedAt) }));
  },
  async pollInbox(creds, _ch, cursor) {
    const a = await agentFor(creds); const res = await a.listNotifications({ limit: 100, cursor, reasons: ['mention', 'reply', 'quote'] as any });
    const items: InboxItem[] = res.data.notifications.filter(n => ['mention', 'reply', 'quote'].includes(n.reason)).map(n => ({ externalId: n.uri, parentExternalId: (n.record as any).reply?.parent?.uri, externalPostId: (n.record as any).reply?.root?.uri ?? n.reasonSubject, kind: n.reason === 'reply' ? 'COMMENT' : 'MENTION', author: { id: n.author.did, name: n.author.displayName, handle: n.author.handle, avatarUrl: n.author.avatar }, text: (n.record as any).text ?? '', createdAt: new Date(n.indexedAt), raw: n }));
    return { items, cursor: res.data.cursor };
  },
  async reply(creds, _ch, item, text) {
    const a = await agentFor(creds); const parentPost = (await a.getPosts({ uris: [item.externalId] })).data.posts[0];
    if (!parentPost) throw new ConnectorError('VALIDATION', 'Post no longer exists', { retryable: false });
    const rootRef = (parentPost.record as any).reply?.root ?? { uri: parentPost.uri, cid: parentPost.cid };
    const rt = new RichText({ text }); await rt.detectFacets(a);
    const res = await a.post({ text: rt.text, facets: rt.facets, reply: { root: rootRef, parent: { uri: parentPost.uri, cid: parentPost.cid } }, createdAt: new Date().toISOString() });
    return { externalId: res.uri };
  },
  async like(creds, _ch, item) { const a = await agentFor(creds); const p = (await a.getPosts({ uris: [item.externalId] })).data.posts[0]; if (p) await a.like(p.uri, p.cid); },
};

async function embedImages(agent: Agent, media: MediaRef[]): Promise<AppBskyEmbedImages.Main> {
  const images: AppBskyEmbedImages.Image[] = [];
  for (const m of media) {
    const src = await streamFromS3(m, 'bsky_image');
    const up = await agent.uploadBlob(await src.bytes, { encoding: src.mime });
    images.push({ image: up.data.blob, alt: (m.altText ?? '').slice(0, 2000), aspectRatio: src.width && src.height ? { width: src.width, height: src.height } : undefined });
  }
  return { $type: 'app.bsky.embed.images', images };
}
async function embedExternal(agent: Agent, url: string, lp?: { title?: string; description?: string; imageAssetId?: string }): Promise<AppBskyEmbedExternal.Main> {
  let thumb: any;
  if (lp?.imageAssetId) { const src = await streamFromS3({ assetId: lp.imageAssetId, kind: 'image' }, 'bsky_image'); thumb = (await agent.uploadBlob(await src.bytes, { encoding: src.mime })).data.blob; }
  return { $type: 'app.bsky.embed.external', external: { uri: url, title: lp?.title ?? url, description: lp?.description ?? '', ...(thumb ? { thumb } : {}) } };
}
async function embedVideo(agent: Agent, did: string, m: MediaRef): Promise<AppBskyEmbedVideo.Main> {
  const src = await streamFromS3(m, 'bsky_video');
  const pdsHost = new URL((agent as any).pdsUrl?.toString?.() ?? 'https://bsky.social').host;
  const svc = await agent.com.atproto.server.getServiceAuth({ aud: `did:web:${pdsHost}`, lxm: 'com.atproto.repo.uploadBlob', exp: Math.floor(Date.now() / 1000) + 1800 });
  const upRes = await http(`https://video.bsky.app/xrpc/app.bsky.video.uploadVideo?did=${did}&name=video.mp4`, { method: 'POST', headers: { Authorization: `Bearer ${svc.data.token}`, 'content-type': 'video/mp4' }, body: await src.bytes, timeoutMs: 10 * 60_000 });
  const up: any = await readJson(upRes);
  let job = up.jobStatus ?? up; const t0 = Date.now();
  while (job.state !== 'JOB_STATE_COMPLETED' && Date.now() - t0 < 10 * 60_000) {
    if (job.state === 'JOB_STATE_FAILED') throw new ConnectorError('MEDIA', job.error ?? 'Bluesky video processing failed', { retryable: false });
    await sleep(5000);
    job = ((await readJson(await http(`https://video.bsky.app/xrpc/app.bsky.video.getJobStatus?jobId=${job.jobId}`))) as any).jobStatus;
  }
  if (!job.blob) throw new ConnectorError('PLATFORM', 'Bluesky video processing timed out', { retryable: true });
  return { $type: 'app.bsky.embed.video', video: job.blob, alt: (m.altText ?? '').slice(0, 2000), aspectRatio: src.width && src.height ? { width: src.width, height: src.height } : undefined };
}
