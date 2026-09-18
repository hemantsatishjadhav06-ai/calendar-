import { env } from '@relay/config';
import { facebookRules } from '@relay/network-rules';
import type { SocialConnector, AuthResult, PublishInput, PublishResult, MediaRef, InboxItem } from '../types.js';
import { graph, graphAll, FB, FB_VIDEO, GRAPH_VERSION, verifyMetaWebhook, waitFor } from './graph.js';
import { ConnectorError, http, mediaUrl, newState, assertConfigured, firstUrl, unix, log } from '../shared/index.js';

const SCOPES = ['pages_show_list', 'pages_read_engagement', 'pages_manage_posts', 'pages_manage_engagement', 'pages_read_user_content', 'pages_manage_metadata', 'read_insights', 'business_management',
  'instagram_basic', 'instagram_content_publish', 'instagram_manage_comments', 'instagram_manage_insights'];

const PAGE_METRICS: Record<string, string> = { page_follows: 'followers', page_daily_follows_unique: 'follows', page_daily_unfollows_unique: 'unfollows', page_media_view: 'impressions', page_total_media_view_unique: 'reach', page_post_engagements: 'engagements', page_views_total: 'profile_views', page_video_views: 'video_views' };

export const facebook: SocialConnector = {
  network: 'FACEBOOK',
  rules: facebookRules,

  async authStart({ redirectUri }) {
    assertConfigured(['META_APP_ID', env.META_APP_ID]);
    const state = newState();
    const url = new URL(`https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth`);
    url.search = new URLSearchParams({ client_id: env.META_APP_ID!, redirect_uri: redirectUri, state, response_type: 'code', ...(env.META_LOGIN_CONFIG_ID ? { config_id: env.META_LOGIN_CONFIG_ID } : { scope: SCOPES.join(',') }) }).toString();
    return { url: url.toString(), state };
  },

  async authCallback({ code, redirectUri }): Promise<AuthResult> {
    const short = await graph(FB, '/oauth/access_token', { token: '', params: { client_id: env.META_APP_ID, client_secret: env.META_APP_SECRET, redirect_uri: redirectUri, code } });
    const long = await graph(FB, '/oauth/access_token', { token: '', params: { grant_type: 'fb_exchange_token', client_id: env.META_APP_ID, client_secret: env.META_APP_SECRET, fb_exchange_token: short.access_token } });
    const userToken: string = long.access_token;
    const userExp = new Date(Date.now() + (long.expires_in ?? 5184000) * 1000);
    const me = await graph(FB, '/me', { token: userToken, params: { fields: 'id,name' } });
    const pages = await graphAll(FB, '/me/accounts', { token: userToken, params: { fields: 'id,name,access_token,tasks,picture{url},instagram_business_account{id,username,profile_picture_url}', limit: 100 } });
    const candidates = pages.filter(p => (p.tasks ?? []).includes('CREATE_CONTENT') || (p.tasks ?? []).includes('MANAGE')).map(p => ({
      externalId: p.id, subtype: 'page', displayName: p.name, avatarUrl: p.picture?.data?.url,
      meta: { igBusinessAccountId: p.instagram_business_account?.id ?? null, igUsername: p.instagram_business_account?.username ?? null, tasks: p.tasks },
      credsOverride: { accessToken: p.access_token, accessExpiresAt: undefined, extra: { userToken, userTokenExpiresAt: userExp.getTime(), fbUserId: me.id } },
    }));
    // Also expose IG accounts linked to pages as Instagram (fb_login variant) candidates — the API layer files them under network INSTAGRAM.
    for (const p of pages) if (p.instagram_business_account) candidates.push({
      externalId: p.instagram_business_account.id, subtype: 'business', displayName: p.instagram_business_account.username, avatarUrl: p.instagram_business_account.profile_picture_url,
      meta: { network: 'INSTAGRAM', variant: 'fb_login', pageId: p.id, handle: p.instagram_business_account.username },
      credsOverride: { accessToken: p.access_token, accessExpiresAt: undefined, extra: { variant: 'fb_login', userToken, userTokenExpiresAt: userExp.getTime(), pageId: p.id } },
    } as any);
    return { creds: { accessToken: userToken, tokenType: 'bearer', accessExpiresAt: userExp, scopes: SCOPES, extra: { fbUserId: me.id } }, candidates };
  },

  async refresh(creds, channel) {
    const long = await graph(FB, '/oauth/access_token', { token: '', params: { grant_type: 'fb_exchange_token', client_id: env.META_APP_ID, client_secret: env.META_APP_SECRET, fb_exchange_token: creds.extra.userToken } });
    const pageId = creds.extra.pageId ?? channel.externalId;
    const page = await graph(FB, `/${pageId}`, { token: long.access_token, params: { fields: 'access_token' } });
    return { ...creds, accessToken: page.access_token, extra: { ...creds.extra, userToken: long.access_token, userTokenExpiresAt: Date.now() + (long.expires_in ?? 5184000) * 1000 } };
  },

  async health(creds) {
    const dbg = await graph(FB, '/debug_token', { token: `${env.META_APP_ID}|${env.META_APP_SECRET}`, params: { input_token: creds.accessToken } });
    const d = dbg.data;
    if (!d?.is_valid) return { ok: false, reason: d?.error?.message ?? 'Token invalid' };
    const missing = ['pages_manage_posts', 'pages_read_engagement'].filter(s => !(d.scopes ?? []).includes(s));
    return missing.length ? { ok: false, reason: `Missing permissions: ${missing.join(', ')}`, scopes: d.scopes } : { ok: true, scopes: d.scopes };
  },

  async afterConnect(creds, channel) {
    await graph(FB, `/${channel.externalId}/subscribed_apps`, { method: 'POST', token: creds.accessToken, params: { subscribed_fields: 'feed,mention' } }).catch(e => log.warn({ e: e.message }, 'fb subscribed_apps failed'));
  },

  publishBudget(target) {
    const md = target.metadata as any;
    return md?.postType === 'reel' ? [{ key: `fb:${target.channelId}:reels`, limit: 30, windowSec: 86400 }] : [];
  },

  async publish({ target, channel, creds }: PublishInput): Promise<PublishResult> {
    const pageId = channel.externalId, token = creds.accessToken;
    const md = (target.metadata ?? {}) as any; const media = (target.media as unknown as MediaRef[]) ?? [];
    const text = target.text;
    let postId: string;

    if (md.postType === 'reel') {
      const start = await graph(FB, `/${pageId}/video_reels`, { method: 'POST', token, body: { upload_phase: 'start' } });
      const up = await http(start.upload_url, { method: 'POST', headers: { Authorization: `OAuth ${token}`, file_url: await mediaUrl(media[0], 'fb_reel') } });
      if (!up.ok) throw new ConnectorError('MEDIA', `Reel upload failed (${up.status})`, { retryable: up.status >= 500 });
      await graph(FB, `/${pageId}/video_reels`, { method: 'POST', token, params: { upload_phase: 'finish', video_id: start.video_id, video_state: 'PUBLISHED', description: text, title: md.title } });
      await waitVideo(start.video_id, token);
      postId = start.video_id;
    } else if (md.postType === 'story') {
      if (media[0].kind === 'video') {
        const start = await graph(FB, `/${pageId}/video_stories`, { method: 'POST', token, body: { upload_phase: 'start' } });
        await http(start.upload_url, { method: 'POST', headers: { Authorization: `OAuth ${token}`, file_url: await mediaUrl(media[0], 'fb_story_video') } });
        const fin = await graph(FB, `/${pageId}/video_stories`, { method: 'POST', token, params: { upload_phase: 'finish', video_id: start.video_id } });
        postId = fin.post_id ?? start.video_id;
      } else {
        const ph = await graph(FB, `/${pageId}/photos`, { method: 'POST', token, params: { url: await mediaUrl(media[0], 'fb_story_image'), published: false } });
        const st = await graph(FB, `/${pageId}/photo_stories`, { method: 'POST', token, params: { photo_id: ph.id } });
        postId = st.post_id;
      }
    } else if (media.length === 1 && media[0].kind === 'video') {
      const res = await graph(FB_VIDEO, `/${pageId}/videos`, { method: 'POST', token, params: { file_url: await mediaUrl(media[0], 'fb_video'), description: text, title: md.title, published: true } });
      await waitVideo(res.id, token);
      postId = res.id;
    } else if (media.length >= 1) {
      const ids: string[] = [];
      for (const m of media) {
        const ph = await graph(FB, `/${pageId}/photos`, { method: 'POST', token, params: { url: await mediaUrl(m, m.kind === 'gif' ? 'fb_gif' : 'fb_feed'), published: false, temporary: true, alt_text_custom: m.altText } });
        ids.push(ph.id);
      }
      const res = await graph(FB, `/${pageId}/feed`, { method: 'POST', token, body: { message: text, attached_media: ids.map(id => ({ media_fbid: id })) } });
      postId = res.id;
    } else {
      const link = md.link ?? target.linkPreviewUrl ?? firstUrl(text);
      const res = await graph(FB, `/${pageId}/feed`, { method: 'POST', token, body: { message: text, ...(link ? { link } : {}) } });
      postId = res.id;
    }

    if (target.firstComment && !['reel', 'story'].includes(md.postType)) {
      await graph(FB, `/${postId}/comments`, { method: 'POST', token, body: { message: target.firstComment } }).catch(e => log.warn({ e: e.message }, 'fb first comment failed'));
    }
    const perm = await graph(FB, `/${postId}`, { token, params: { fields: 'permalink_url' } }).catch(() => ({}));
    return { externalId: postId, url: perm.permalink_url };
  },

  async deletePost(creds, _ch, id) { await graph(FB, `/${id}`, { method: 'DELETE', token: creds.accessToken }); },

  async collectChannelMetrics({ channel, creds, since, until }) {
    const r = await graph(FB, `/${channel.externalId}/insights`, { token: creds.accessToken, params: { metric: Object.keys(PAGE_METRICS).join(','), period: 'day', since: unix(since), until: unix(until) } }).catch(() => ({ data: [] }));
    const rows = (r.data ?? []).flatMap((m: any) => (m.values ?? []).map((v: any) => ({ day: String(v.end_time).slice(0, 10), metric: PAGE_METRICS[m.name], value: Number(v.value) || 0 })));
    const page = await graph(FB, `/${channel.externalId}`, { token: creds.accessToken, params: { fields: 'followers_count' } }).catch(() => ({}));
    if (page.followers_count != null) rows.push({ day: until.toISOString().slice(0, 10), metric: 'followers', value: page.followers_count });
    return rows;
  },

  async collectPostMetrics({ creds, externalPostIds }) {
    const out: { externalPostId: string; metric: string; value: number }[] = [];
    for (const id of externalPostIds) {
      const [ins, base] = await Promise.all([
        graph(FB, `/${id}/insights`, { token: creds.accessToken, params: { metric: 'post_media_view,post_total_media_view_unique,post_clicks,post_reactions_by_type_total,post_video_views' } }).catch(() => ({ data: [] })),
        graph(FB, `/${id}`, { token: creds.accessToken, params: { fields: 'shares,comments.summary(true).limit(0),reactions.summary(true).limit(0)' } }).catch(() => ({})),
      ]);
      const get = (n: string) => ins.data?.find((m: any) => m.name === n)?.values?.[0]?.value;
      const reactions = (get('post_reactions_by_type_total') ?? {}) as Record<string, number>;
      out.push(
        { externalPostId: id, metric: 'impressions', value: Number(get('post_media_view') ?? 0) },
        { externalPostId: id, metric: 'reach', value: Number(get('post_total_media_view_unique') ?? 0) },
        { externalPostId: id, metric: 'clicks', value: Number(get('post_clicks') ?? 0) },
        { externalPostId: id, metric: 'likes', value: Object.values(reactions).reduce((a, b) => a + Number(b), 0) || (base.reactions?.summary?.total_count ?? 0) },
        { externalPostId: id, metric: 'comments', value: base.comments?.summary?.total_count ?? 0 },
        { externalPostId: id, metric: 'shares', value: base.shares?.count ?? 0 },
        { externalPostId: id, metric: 'video_views', value: Number(get('post_video_views') ?? 0) },
      );
    }
    return out;
  },

  async listRecentPosts(creds, channel, since) {
    const r = await graph(FB, `/${channel.externalId}/published_posts`, { token: creds.accessToken, params: { fields: 'id,message,created_time,permalink_url,full_picture', since: unix(since), limit: 50 } }).catch(() => ({ data: [] }));
    return (r.data ?? []).map((p: any) => ({ externalId: p.id, text: p.message, url: p.permalink_url, createdAt: new Date(p.created_time), mediaUrl: p.full_picture }));
  },

  async pollInbox(creds, channel, cursor) {
    const posts = await graph(FB, `/${channel.externalId}/published_posts`, { token: creds.accessToken, params: { fields: 'id', limit: 25, since: cursor } }).catch(() => ({ data: [] }));
    const items: InboxItem[] = [];
    for (const p of posts.data ?? []) {
      const c = await graph(FB, `/${p.id}/comments`, { token: creds.accessToken, params: { fields: 'id,from,message,created_time,like_count,is_hidden,parent,attachment', filter: 'stream', order: 'reverse_chronological', limit: 100 } }).catch(() => ({ data: [] }));
      for (const x of c.data ?? []) items.push({ externalId: x.id, parentExternalId: x.parent?.id, externalPostId: p.id, kind: x.parent ? 'REPLY' : 'COMMENT', author: { id: x.from?.id, name: x.from?.name }, text: x.message ?? '', createdAt: new Date(x.created_time), likeCount: x.like_count, isHidden: x.is_hidden, isOurs: x.from?.id === channel.externalId, attachments: x.attachment ? [x.attachment] : [], raw: x });
    }
    return { items, cursor: String(unix(new Date())) };
  },
  async reply(creds, _ch, item, text) { const r = await graph(FB, `/${item.externalId}/comments`, { method: 'POST', token: creds.accessToken, body: { message: text } }); return { externalId: r.id }; },
  async like(creds, _ch, item) { await graph(FB, `/${item.externalId}/likes`, { method: 'POST', token: creds.accessToken }); },
  async hide(creds, _ch, item, hidden) { await graph(FB, `/${item.externalId}`, { method: 'POST', token: creds.accessToken, body: { is_hidden: hidden } }); },
  async deleteComment(creds, _ch, item) { await graph(FB, `/${item.externalId}`, { method: 'DELETE', token: creds.accessToken }); },

  verifyWebhook: req => verifyMetaWebhook(req, env.META_APP_SECRET ?? '', env.META_WEBHOOK_VERIFY_TOKEN),
  parseWebhook(body) {
    if (body.object === 'permissions' || body.object === 'user') return (body.entry ?? []).map((e: any) => ({ externalChannelId: e.id, kind: 'permissions' as const, raw: e }));
    if (body.object !== 'page') return [];
    return (body.entry ?? []).flatMap((e: any) => (e.changes ?? []).map((c: any) => {
      if (c.field === 'feed' && c.value?.item === 'comment' && c.value.verb === 'add') {
        return { externalChannelId: e.id, kind: 'inbox' as const, raw: c, items: [{ externalId: c.value.comment_id, parentExternalId: c.value.parent_id && c.value.parent_id !== c.value.post_id ? c.value.parent_id : undefined, externalPostId: c.value.post_id, kind: (c.value.parent_id && c.value.parent_id !== c.value.post_id ? 'REPLY' : 'COMMENT') as InboxItem['kind'], author: { id: c.value.from?.id, name: c.value.from?.name }, text: c.value.message ?? '', createdAt: new Date((c.value.created_time ?? e.time) * 1000), isOurs: c.value.from?.id === e.id, raw: c.value }] };
      }
      if (c.field === 'mention') return { externalChannelId: e.id, kind: 'inbox' as const, raw: c, items: [{ externalId: c.value.comment_id ?? c.value.post_id, externalPostId: c.value.post_id, kind: 'MENTION' as const, author: { id: c.value.sender_id, name: c.value.sender_name }, text: c.value.message ?? '', createdAt: new Date(e.time * 1000), raw: c.value }] };
      return { externalChannelId: e.id, kind: 'inbox' as const, raw: c, items: [] };
    }));
  },
};

async function waitVideo(videoId: string, token: string) {
  await waitFor(async () => {
    const s = await graph(FB, `/${videoId}`, { token, params: { fields: 'status' } });
    const st = s.status?.video_status;
    if (st === 'ready') return 'ok';
    if (st === 'error') return { error: s.status?.processing_phase?.errors?.[0]?.message ?? 'Facebook rejected the video' };
    return 'wait';
  }, { label: 'Facebook video' });
}
