import { env } from '@cadence/config';
import { threadsRules } from '@cadence/network-rules';
import type { SocialConnector, MediaRef, InboxItem } from '../types.js';
import { graph, THREADS, verifyMetaWebhook, waitFor } from './graph.js';
import { ConnectorError, http, readJson, mediaUrl, newState, assertConfigured, unix } from '../shared/index.js';

const TH_SCOPES = ['threads_basic', 'threads_content_publish', 'threads_manage_replies', 'threads_read_replies', 'threads_manage_insights', 'threads_manage_mentions', 'threads_delete'];
const CANON: Record<string, string> = { views: 'impressions', likes: 'likes', replies: 'comments', reposts: 'shares', quotes: 'quotes', shares: 'shares', clicks: 'link_clicks', followers_count: 'followers' };

interface Part { text: string; media: MediaRef[] }

export const threads: SocialConnector = {
  network: 'THREADS',
  rules: threadsRules,

  async authStart({ redirectUri }) {
    assertConfigured(['THREADS_APP_ID', env.THREADS_APP_ID]);
    const state = newState();
    return { url: 'https://threads.net/oauth/authorize?' + new URLSearchParams({ client_id: env.THREADS_APP_ID!, redirect_uri: redirectUri, scope: TH_SCOPES.join(','), response_type: 'code', state }), state };
  },
  async authCallback({ code, redirectUri }) {
    const res = await http(`${THREADS}/oauth/access_token`, { method: 'POST', body: new URLSearchParams({ client_id: env.THREADS_APP_ID!, client_secret: env.THREADS_APP_SECRET!, grant_type: 'authorization_code', redirect_uri: redirectUri, code }) });
    const short: any = await readJson(res);
    if (!short.access_token) throw new ConnectorError('AUTH', short.error_message ?? short.error?.message ?? 'Threads login failed', { retryable: false, raw: short });
    const long = await graph(THREADS, '/access_token', { token: short.access_token, params: { grant_type: 'th_exchange_token', client_secret: env.THREADS_APP_SECRET } });
    const me = await graph(THREADS, '/me', { token: long.access_token, params: { fields: 'id,username,name,threads_profile_picture_url' } });
    return {
      creds: { accessToken: long.access_token, tokenType: 'bearer', accessExpiresAt: new Date(Date.now() + long.expires_in * 1000), scopes: TH_SCOPES, extra: {} },
      candidates: [{ externalId: me.id, subtype: 'profile', displayName: me.name ?? me.username, handle: me.username, avatarUrl: me.threads_profile_picture_url }],
    };
  },
  async refresh(creds) {
    const r = await graph(THREADS, '/refresh_access_token', { token: creds.accessToken, params: { grant_type: 'th_refresh_token' } });
    return { ...creds, accessToken: r.access_token, accessExpiresAt: new Date(Date.now() + r.expires_in * 1000) };
  },
  async health(creds) { try { await graph(THREADS, '/me', { token: creds.accessToken, params: { fields: 'id' } }); return { ok: true }; } catch (e: any) { return { ok: false, reason: e.message }; } },

  publishBudget(target) {
    const parts = 1 + (((target.thread as any[]) ?? []).length);
    return [{ key: `th:${target.channelId}:posts`, limit: 250, windowSec: 86400 }, ...(parts > 1 ? [{ key: `th:${target.channelId}:replies`, limit: 1000, windowSec: 86400, cost: parts - 1 }] : [])];
  },

  async publish({ target, channel, creds }) {
    const uid = channel.externalId, token = creds.accessToken, md = (target.metadata ?? {}) as any;
    const parts: Part[] = [{ text: target.text, media: (target.media as unknown as MediaRef[]) ?? [] }, ...(((target.thread as any[]) ?? []) as Part[])];
    let rootId: string | undefined, prevId: string | undefined, url: string | undefined;
    for (const [i, part] of parts.entries()) {
      const id = await createAndPublish(uid, token, part, {
        reply_to_id: prevId,
        topic_tag: i === 0 ? md.topicTag : undefined,
        reply_control: i === 0 ? md.replyControl : undefined,
        link_attachment: i === 0 && part.media.length === 0 ? target.linkPreviewUrl ?? undefined : undefined,
        poll_attachment: i === 0 ? md.poll : undefined,
      });
      if (i === 0) { rootId = id; url = (await graph(THREADS, `/${id}`, { token, params: { fields: 'permalink' } }).catch(() => ({}))).permalink; }
      prevId = id;
    }
    return { externalId: rootId!, url };
  },
  async deletePost(creds, _ch, id) { await graph(THREADS, `/${id}`, { method: 'DELETE', token: creds.accessToken }); },

  async collectChannelMetrics({ channel, creds, since, until }) {
    const r = await graph(THREADS, `/${channel.externalId}/threads_insights`, { token: creds.accessToken, params: { metric: 'views,likes,replies,reposts,quotes,clicks,followers_count', since: unix(since), until: unix(until) } }).catch(() => ({ data: [] }));
    const rows: { day: string; metric: string; value: number }[] = [];
    for (const m of r.data ?? []) {
      if (m.values) for (const v of m.values) rows.push({ day: String(v.end_time ?? until.toISOString()).slice(0, 10), metric: CANON[m.name] ?? m.name, value: Number(v.value) });
      else rows.push({ day: until.toISOString().slice(0, 10), metric: CANON[m.name] ?? m.name, value: Number(m.total_value?.value ?? 0) });
    }
    return rows;
  },
  async collectPostMetrics({ creds, externalPostIds }) {
    const out: { externalPostId: string; metric: string; value: number }[] = [];
    for (const id of externalPostIds) {
      const r = await graph(THREADS, `/${id}/insights`, { token: creds.accessToken, params: { metric: 'views,likes,replies,reposts,quotes,shares' } }).catch(() => ({ data: [] }));
      for (const m of r.data ?? []) out.push({ externalPostId: id, metric: CANON[m.name] ?? m.name, value: Number(m.values?.[0]?.value ?? 0) });
    }
    return out;
  },
  async listRecentPosts(creds, channel, since) {
    const r = await graph(THREADS, `/${channel.externalId}/threads`, { token: creds.accessToken, params: { fields: 'id,text,permalink,timestamp,thumbnail_url,media_url', since: unix(since), limit: 50 } }).catch(() => ({ data: [] }));
    return (r.data ?? []).map((p: any) => ({ externalId: p.id, text: p.text, url: p.permalink, createdAt: new Date(p.timestamp), mediaUrl: p.thumbnail_url ?? p.media_url }));
  },
  async pollInbox(creds, channel, cursor) {
    const items: InboxItem[] = [];
    const posts = await graph(THREADS, `/${channel.externalId}/threads`, { token: creds.accessToken, params: { fields: 'id', limit: 25, since: cursor } }).catch(() => ({ data: [] }));
    for (const p of posts.data ?? []) {
      const r = await graph(THREADS, `/${p.id}/conversation`, { token: creds.accessToken, params: { fields: 'id,text,username,timestamp,replied_to,hide_status,is_reply_owned_by_me,media_type,media_url,permalink', reverse: false } }).catch(() => ({ data: [] }));
      for (const x of r.data ?? []) items.push({ externalId: x.id, parentExternalId: x.replied_to?.id, externalPostId: p.id, kind: x.replied_to?.id === p.id ? 'COMMENT' : 'REPLY', author: { handle: x.username }, text: x.text ?? '', createdAt: new Date(x.timestamp), isHidden: x.hide_status === 'HIDDEN', isOurs: !!x.is_reply_owned_by_me, raw: x });
    }
    const mentions = await graph(THREADS, `/${channel.externalId}/mentions`, { token: creds.accessToken, params: { fields: 'id,text,username,timestamp,permalink', since: cursor } }).catch(() => ({ data: [] }));
    for (const x of mentions.data ?? []) items.push({ externalId: x.id, kind: 'MENTION', author: { handle: x.username }, text: x.text ?? '', createdAt: new Date(x.timestamp), raw: x });
    return { items, cursor: String(unix(new Date())) };
  },
  async reply(creds, ch, item, text) { const id = await createAndPublish(ch.externalId, creds.accessToken, { text, media: [] }, { reply_to_id: item.externalId }); return { externalId: id }; },
  async hide(creds, _ch, item, hidden) { await graph(THREADS, `/${item.externalId}/manage_reply`, { method: 'POST', token: creds.accessToken, params: { hide: hidden } }); },

  verifyWebhook: req => verifyMetaWebhook(req, env.THREADS_APP_SECRET ?? '', env.META_WEBHOOK_VERIFY_TOKEN),
  parseWebhook(body) {
    if (body.object !== 'threads') return [];
    return (body.entry ?? []).flatMap((e: any) => (e.changes ?? []).filter((c: any) => c.field === 'replies' || c.field === 'mentions').map((c: any) => ({
      externalChannelId: e.id, kind: 'inbox' as const, raw: c,
      items: [{ externalId: c.value.id, parentExternalId: c.value.replied_to?.id, externalPostId: c.value.root_post?.id, kind: (c.field === 'mentions' ? 'MENTION' : 'COMMENT') as InboxItem['kind'], author: { handle: c.value.username }, text: c.value.text ?? '', createdAt: new Date(c.value.timestamp ?? e.time * 1000), raw: c.value }],
    })));
  },
};

async function createAndPublish(uid: string, token: string, part: Part, extra: Record<string, any>) {
  const clean = Object.fromEntries(Object.entries(extra).filter(([, v]) => v !== undefined));
  let creationId: string;
  if (part.media.length > 1) {
    const children: string[] = [];
    for (const m of part.media) {
      const c = await graph(THREADS, `/${uid}/threads`, { method: 'POST', token, params: { is_carousel_item: true, media_type: m.kind === 'video' ? 'VIDEO' : 'IMAGE', [m.kind === 'video' ? 'video_url' : 'image_url']: await mediaUrl(m, m.kind === 'video' ? 'th_video' : 'th_image'), alt_text: m.altText } });
      children.push(c.id);
    }
    for (const id of children) await waitThreads(id, token);
    creationId = (await graph(THREADS, `/${uid}/threads`, { method: 'POST', token, params: { media_type: 'CAROUSEL', children: children.join(','), text: part.text, ...clean } })).id;
  } else if (part.media.length === 1) {
    const m = part.media[0];
    creationId = (await graph(THREADS, `/${uid}/threads`, { method: 'POST', token, params: { media_type: m.kind === 'video' ? 'VIDEO' : 'IMAGE', [m.kind === 'video' ? 'video_url' : 'image_url']: await mediaUrl(m, m.kind === 'video' ? 'th_video' : 'th_image'), text: part.text, alt_text: m.altText, ...clean } })).id;
  } else {
    creationId = (await graph(THREADS, `/${uid}/threads`, { method: 'POST', token, params: { media_type: 'TEXT', text: part.text, ...clean } })).id;
  }
  await waitThreads(creationId, token);
  return (await graph(THREADS, `/${uid}/threads_publish`, { method: 'POST', token, params: { creation_id: creationId } })).id as string;
}
async function waitThreads(id: string, token: string) {
  await waitFor(async () => {
    const s = await graph(THREADS, `/${id}`, { token, params: { fields: 'status,error_message' } });
    if (s.status === 'FINISHED' || s.status === 'PUBLISHED') return 'ok';
    if (s.status === 'ERROR' || s.status === 'EXPIRED') return { error: s.error_message ?? 'Threads rejected the media' };
    return 'wait';
  }, { label: 'Threads media', initialMs: 3000 });
}
