import { env } from '@cadence/config';
import { instagramRules } from '@cadence/network-rules';
import type { Channel } from '@cadence/db';
import type { SocialConnector, Creds, MediaRef, InboxItem } from '../types.js';
import { graph, FB, IG, verifyMetaWebhook, waitFor } from './graph.js';
import { ConnectorError, http, readJson, mediaUrl, newState, assertConfigured, unix, log } from '../shared/index.js';

const IG_SCOPES = ['instagram_business_basic', 'instagram_business_content_publish', 'instagram_business_manage_comments', 'instagram_business_manage_insights', 'instagram_business_manage_messages'];

const base = (creds: Creds) => (creds.extra?.variant === 'fb_login' ? FB : IG);
const CANON: Record<string, string> = { views: 'impressions', reach: 'reach', saved: 'saves', saves: 'saves', shares: 'shares', total_interactions: 'engagements', likes: 'likes', comments: 'comments', follows: 'follows', profile_views: 'profile_views', profile_visits: 'profile_views', website_clicks: 'link_clicks', profile_links_taps: 'link_clicks', accounts_engaged: 'accounts_engaged', replies: 'replies', ig_reels_avg_watch_time: 'avg_watch_time_ms', ig_reels_video_view_total_time: 'watch_time_ms', follows_and_unfollows: 'follows_net', navigation: 'story_navigation' };
const canon = (n: string) => CANON[n] ?? n;

export const instagram: SocialConnector = {
  network: 'INSTAGRAM',
  rules: instagramRules,

  async authStart({ redirectUri }) {
    assertConfigured(['IG_APP_ID', env.IG_APP_ID]);
    const state = newState();
    const url = 'https://www.instagram.com/oauth/authorize?' + new URLSearchParams({ client_id: env.IG_APP_ID!, redirect_uri: redirectUri, response_type: 'code', scope: IG_SCOPES.join(','), state, force_reauth: 'true' });
    return { url, state };
  },

  async authCallback({ code, redirectUri }) {
    const form = new URLSearchParams({ client_id: env.IG_APP_ID!, client_secret: env.IG_APP_SECRET!, grant_type: 'authorization_code', redirect_uri: redirectUri, code });
    const shortRes = await http('https://api.instagram.com/oauth/access_token', { method: 'POST', body: form });
    const short: any = await readJson(shortRes);
    const shortToken = short.access_token ?? short.data?.[0]?.access_token;
    if (!shortToken) throw new ConnectorError('AUTH', short.error_message ?? short.error?.message ?? 'Instagram login failed', { retryable: false, raw: short });
    const long = await graph(IG, '/access_token', { token: shortToken, params: { grant_type: 'ig_exchange_token', client_secret: env.IG_APP_SECRET } });
    const me = await graph(IG, '/me', { token: long.access_token, params: { fields: 'user_id,username,name,account_type,profile_picture_url' } });
    if (!['BUSINESS', 'MEDIA_CREATOR'].includes(me.account_type)) throw new ConnectorError('POLICY', 'Instagram account must be a Business or Creator account for automatic publishing (switch in Instagram → Settings → Account type)', { retryable: false });
    return {
      creds: { accessToken: long.access_token, tokenType: 'bearer', accessExpiresAt: new Date(Date.now() + long.expires_in * 1000), scopes: (short.permissions ?? IG_SCOPES.join(',')).split(','), extra: { variant: 'ig_login' } },
      candidates: [{ externalId: String(me.user_id ?? me.id), subtype: me.account_type === 'BUSINESS' ? 'business' : 'creator', displayName: me.name ?? me.username, handle: me.username, avatarUrl: me.profile_picture_url }],
    };
  },

  async refresh(creds, channel) {
    if (creds.extra?.variant === 'fb_login') {
      const long = await graph(FB, '/oauth/access_token', { token: '', params: { grant_type: 'fb_exchange_token', client_id: env.META_APP_ID, client_secret: env.META_APP_SECRET, fb_exchange_token: creds.extra.userToken } });
      const page = await graph(FB, `/${creds.extra.pageId}`, { token: long.access_token, params: { fields: 'access_token' } });
      return { ...creds, accessToken: page.access_token, extra: { ...creds.extra, userToken: long.access_token, userTokenExpiresAt: Date.now() + long.expires_in * 1000 } };
    }
    const r = await graph(IG, '/refresh_access_token', { token: creds.accessToken, params: { grant_type: 'ig_refresh_token' } });
    return { ...creds, accessToken: r.access_token, accessExpiresAt: new Date(Date.now() + r.expires_in * 1000) };
  },

  async health(creds, channel) {
    try { await graph(base(creds), `/${channel.externalId}`, { token: creds.accessToken, params: { fields: 'id,username' } }); return { ok: true }; }
    catch (e: any) { return { ok: false, reason: e.message }; }
  },

  async afterConnect(creds, channel) {
    if (creds.extra?.variant === 'ig_login') await graph(IG, `/${channel.externalId}/subscribed_apps`, { method: 'POST', token: creds.accessToken, params: { subscribed_fields: 'comments,mentions,messages,story_insights' } }).catch(e => log.warn({ e: e.message }, 'ig subscribed_apps failed'));
  },

  publishBudget(target) { return [{ key: `ig:${target.channelId}:posts`, limit: 100, windowSec: 86400 }]; },

  async publish({ target, channel, creds }) {
    const B = base(creds), uid = channel.externalId, token = creds.accessToken;
    const md = (target.metadata ?? {}) as any; const media = (target.media as unknown as MediaRef[]) ?? [];
    const q = await graph(B, `/${uid}/content_publishing_limit`, { token, params: { fields: 'quota_usage,config' } }).catch(() => null);
    if (q?.data?.[0] && q.data[0].quota_usage >= q.data[0].config.quota_total) throw new ConnectorError('RATE_LIMIT', `Instagram's ${q.data[0].config.quota_total}-post daily limit reached`, { retryable: true, retryAfterMs: 60 * 60_000 });

    const common: Record<string, any> = { caption: target.text, location_id: md.locationId, collaborators: md.collaborators, share_to_feed: md.shareToFeed };
    let creationId: string;

    if (md.postType === 'story') {
      const m = media[0];
      const c = await graph(B, `/${uid}/media`, { method: 'POST', token, params: { media_type: 'STORIES', ...(m.kind === 'video' ? { video_url: await mediaUrl(m, 'ig_story_video') } : { image_url: await mediaUrl(m, 'ig_story_jpeg') }) } });
      creationId = c.id;
    } else if (media.length > 1) {
      const children: string[] = [];
      for (const m of media) {
        const c = await graph(B, `/${uid}/media`, { method: 'POST', token, params: { is_carousel_item: true, ...(m.kind === 'video' ? { media_type: 'VIDEO', video_url: await mediaUrl(m, 'ig_carousel_video') } : { image_url: await mediaUrl(m, 'ig_feed_jpeg'), alt_text: m.altText, user_tags: m.userTags?.map(u => ({ username: u.username, x: u.x ?? 0.5, y: u.y ?? 0.5 })) }) } });
        children.push(c.id);
      }
      for (const id of children) await waitContainer(B, id, token);
      const c = await graph(B, `/${uid}/media`, { method: 'POST', token, params: { media_type: 'CAROUSEL', children: children.join(','), ...common } });
      creationId = c.id;
    } else if (media[0]?.kind === 'video') {
      const m = media[0];
      const c = await graph(B, `/${uid}/media`, { method: 'POST', token, params: {
        media_type: 'REELS', video_url: await mediaUrl(m, 'ig_reel'), ...common,
        cover_url: m.cover?.assetId ? await mediaUrl({ assetId: m.cover.assetId, kind: 'image' }, 'ig_feed_jpeg') : undefined,
        thumb_offset: m.cover?.assetId ? undefined : m.cover?.offsetMs,
        user_tags: m.userTags?.map(u => ({ username: u.username })), audio_name: md.audioName,
      } });
      creationId = c.id;
    } else if (media[0]) {
      const m = media[0];
      const c = await graph(B, `/${uid}/media`, { method: 'POST', token, params: { image_url: await mediaUrl(m, 'ig_feed_jpeg'), alt_text: m.altText, user_tags: m.userTags?.map(u => ({ username: u.username, x: u.x ?? 0.5, y: u.y ?? 0.5 })), product_tags: md.productTags, ...common } });
      creationId = c.id;
    } else {
      throw new ConnectorError('VALIDATION', 'Instagram requires an image or video', { retryable: false });
    }

    await waitContainer(B, creationId, token);
    const pub = await graph(B, `/${uid}/media_publish`, { method: 'POST', token, params: { creation_id: creationId } });
    const mediaId: string = pub.id;

    if (target.firstComment && md.postType !== 'story') {
      await graph(B, `/${mediaId}/comments`, { method: 'POST', token, params: { message: target.firstComment } }).catch(e => log.warn({ e: e.message }, 'ig first comment failed'));
    }
    const info = await graph(B, `/${mediaId}`, { token, params: { fields: 'permalink' } }).catch(() => ({}));
    return { externalId: mediaId, url: info.permalink };
  },

  async collectChannelMetrics({ channel, creds, since, until }) {
    const B = base(creds), token = creds.accessToken, uid = channel.externalId;
    const rows: { day: string; metric: string; value: number }[] = [];
    const day = until.toISOString().slice(0, 10);
    const tv = await graph(B, `/${uid}/insights`, { token, params: { metric: 'reach,views,total_interactions,likes,comments,shares,saves,accounts_engaged,profile_views,website_clicks,profile_links_taps', period: 'day', metric_type: 'total_value', since: unix(since), until: unix(until) } }).catch(() => ({ data: [] }));
    for (const m of tv.data ?? []) rows.push({ day, metric: canon(m.name), value: Number(m.total_value?.value ?? 0) });
    const fc = await graph(B, `/${uid}/insights`, { token, params: { metric: 'follower_count', period: 'day', since: unix(since), until: unix(until) } }).catch(() => ({ data: [] }));
    for (const m of fc.data ?? []) for (const v of m.values ?? []) rows.push({ day: String(v.end_time).slice(0, 10), metric: 'follows', value: Number(v.value) });
    const prof = await graph(B, `/${uid}`, { token, params: { fields: 'followers_count,media_count' } }).catch(() => ({}));
    if (prof.followers_count != null) rows.push({ day, metric: 'followers', value: prof.followers_count });
    return rows;
  },

  async collectPostMetrics({ creds, externalPostIds }) {
    const B = base(creds); const out: { externalPostId: string; metric: string; value: number }[] = [];
    for (const id of externalPostIds) {
      const info = await graph(B, `/${id}`, { token: creds.accessToken, params: { fields: 'media_product_type,like_count,comments_count' } }).catch(() => null);
      if (!info) continue;
      const metric = info.media_product_type === 'REELS' ? 'views,reach,saved,shares,total_interactions,likes,comments,ig_reels_avg_watch_time,ig_reels_video_view_total_time'
        : info.media_product_type === 'STORY' ? 'views,reach,shares,total_interactions,replies,profile_visits,follows'
        : 'views,reach,saved,shares,total_interactions,likes,comments,follows,profile_visits';
      const ins = await graph(B, `/${id}/insights`, { token: creds.accessToken, params: { metric } }).catch(() => ({ data: [] }));
      for (const m of ins.data ?? []) out.push({ externalPostId: id, metric: canon(m.name), value: Number(m.values?.[0]?.value ?? 0) });
      out.push({ externalPostId: id, metric: 'likes', value: info.like_count ?? 0 }, { externalPostId: id, metric: 'comments', value: info.comments_count ?? 0 });
    }
    return out;
  },

  async collectAudience({ channel, creds }) {
    const B = base(creds); const out: { dimension: string; bucket: string; value: number }[] = [];
    for (const breakdown of ['age', 'gender', 'city', 'country']) {
      const r = await graph(B, `/${channel.externalId}/insights`, { token: creds.accessToken, params: { metric: 'follower_demographics', period: 'lifetime', timeframe: 'last_30_days', metric_type: 'total_value', breakdown } }).catch(() => null);
      for (const x of r?.data?.[0]?.total_value?.breakdowns?.[0]?.results ?? []) out.push({ dimension: breakdown, bucket: (x.dimension_values ?? []).join('|'), value: Number(x.value) });
    }
    return out;
  },

  async listRecentPosts(creds, channel, since) {
    const r = await graph(base(creds), `/${channel.externalId}/media`, { token: creds.accessToken, params: { fields: 'id,caption,permalink,timestamp,media_url,thumbnail_url', since: unix(since), limit: 50 } }).catch(() => ({ data: [] }));
    return (r.data ?? []).map((m: any) => ({ externalId: m.id, text: m.caption, url: m.permalink, createdAt: new Date(m.timestamp), mediaUrl: m.thumbnail_url ?? m.media_url }));
  },

  async pollInbox(creds, channel, cursor) {
    const B = base(creds); const items: InboxItem[] = [];
    const media = await graph(B, `/${channel.externalId}/media`, { token: creds.accessToken, params: { fields: 'id,timestamp', limit: 25, since: cursor } }).catch(() => ({ data: [] }));
    for (const m of media.data ?? []) {
      const c = await graph(B, `/${m.id}/comments`, { token: creds.accessToken, params: { fields: 'id,text,username,from,timestamp,like_count,hidden,replies{id,text,username,from,timestamp,like_count,hidden}', limit: 50 } }).catch(() => ({ data: [] }));
      for (const x of c.data ?? []) {
        items.push(norm(x, m.id, channel));
        for (const r of x.replies?.data ?? []) items.push({ ...norm(r, m.id, channel), parentExternalId: x.id, kind: 'REPLY' });
      }
    }
    return { items, cursor: String(unix(new Date())) };
  },
  async reply(creds, _ch, item, text) {
    const B = base(creds);
    // Only one level of nesting: replying to a reply targets its parent comment
    const targetId = item.parentExternalId ?? item.externalId;
    const r = await graph(B, `/${targetId}/replies`, { method: 'POST', token: creds.accessToken, params: { message: text } });
    return { externalId: r.id };
  },
  async hide(creds, _ch, item, hidden) { await graph(base(creds), `/${item.externalId}`, { method: 'POST', token: creds.accessToken, params: { hide: hidden } }); },
  async deleteComment(creds, _ch, item) { await graph(base(creds), `/${item.externalId}`, { method: 'DELETE', token: creds.accessToken }); },

  verifyWebhook: req => verifyMetaWebhook(req, env.IG_APP_SECRET ?? env.META_APP_SECRET ?? '', env.META_WEBHOOK_VERIFY_TOKEN),
  parseWebhook(body) {
    if (body.object !== 'instagram') return [];
    return (body.entry ?? []).flatMap((e: any) => (e.changes ?? []).map((c: any) => {
      const t = new Date((e.time ?? Date.now() / 1000) * 1000);
      if (c.field === 'comments') return { externalChannelId: e.id, kind: 'inbox' as const, raw: c, items: [{ externalId: c.value.id, parentExternalId: c.value.parent_id, externalPostId: c.value.media?.id, kind: (c.value.parent_id ? 'REPLY' : 'COMMENT') as InboxItem['kind'], author: { id: c.value.from?.id, handle: c.value.from?.username }, text: c.value.text ?? '', createdAt: t, isOurs: c.value.from?.id === e.id, raw: c.value }] };
      if (c.field === 'mentions') return { externalChannelId: e.id, kind: 'inbox' as const, raw: c, items: [{ externalId: c.value.comment_id ?? c.value.media_id, externalPostId: c.value.media_id, kind: 'MENTION' as const, author: {}, text: '', createdAt: t, raw: { ...c.value, needsEnrichment: true } }] };
      if (c.field === 'story_insights') return { externalChannelId: e.id, kind: 'story_insights' as const, raw: c };
      return { externalChannelId: e.id, kind: 'inbox' as const, raw: c, items: [] };
    }));
  },
};

async function waitContainer(B: string, id: string, token: string) {
  await waitFor(async () => {
    const s = await graph(B, `/${id}`, { token, params: { fields: 'status_code,status' } });
    if (s.status_code === 'FINISHED' || s.status_code === 'PUBLISHED') return 'ok';
    if (s.status_code === 'ERROR' || s.status_code === 'EXPIRED') return { error: `Instagram could not process the media: ${s.status ?? s.status_code}` };
    return 'wait';
  }, { label: 'Instagram media' });
}
const norm = (x: any, mediaId: string, channel: Channel): InboxItem => ({ externalId: x.id, externalPostId: mediaId, kind: 'COMMENT', author: { id: x.from?.id, handle: x.username ?? x.from?.username }, text: x.text ?? '', createdAt: new Date(x.timestamp), likeCount: x.like_count, isHidden: x.hidden, isOurs: (x.from?.id ?? '') === channel.externalId, raw: x });
