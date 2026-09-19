import { env } from '@cadence/config';
import { tiktokRules } from '@cadence/network-rules';
import type { SocialConnector, MediaRef } from '../types.js';
import { ConnectorError, http, readJson, newState, assertConfigured, mediaUrl, sleep, chunks, hmacHex, safeEqual } from '../shared/index.js';

const TT = 'https://open.tiktokapis.com/v2';
const SCOPES = ['user.info.basic', 'user.info.profile', 'user.info.stats', 'video.list', 'video.upload', 'video.publish'];

export interface CreatorInfo { creator_nickname: string; creator_username: string; creator_avatar_url: string; privacy_level_options: string[]; comment_disabled: boolean; duet_disabled: boolean; stitch_disabled: boolean; max_video_post_duration_sec: number }

export const tiktok: SocialConnector = {
  network: 'TIKTOK',
  rules: tiktokRules,

  async authStart({ redirectUri }) {
    assertConfigured(['TT_CLIENT_KEY', env.TT_CLIENT_KEY]);
    const state = newState();
    return { url: 'https://www.tiktok.com/v2/auth/authorize/?' + new URLSearchParams({ client_key: env.TT_CLIENT_KEY!, response_type: 'code', scope: SCOPES.join(','), redirect_uri: redirectUri, state }), state };
  },
  async authCallback({ code, redirectUri }) {
    const tok = await token({ grant_type: 'authorization_code', code, redirect_uri: redirectUri });
    const me = await call('/user/info/?fields=open_id,union_id,avatar_url,display_name,username,follower_count,is_verified', tok.access_token, undefined, 'GET');
    const u = me.data.user;
    return {
      creds: { accessToken: tok.access_token, refreshToken: tok.refresh_token, tokenType: 'bearer', accessExpiresAt: new Date(Date.now() + tok.expires_in * 1000), refreshExpiresAt: new Date(Date.now() + tok.refresh_expires_in * 1000), scopes: String(tok.scope).split(','), extra: { openId: tok.open_id } },
      candidates: [{ externalId: tok.open_id, subtype: 'creator', displayName: u.display_name, handle: u.username, avatarUrl: u.avatar_url, meta: { unionId: u.union_id } }],
    };
  },
  async refresh(creds) {
    const tok = await token({ grant_type: 'refresh_token', refresh_token: creds.refreshToken! });
    return { ...creds, accessToken: tok.access_token, refreshToken: tok.refresh_token ?? creds.refreshToken, accessExpiresAt: new Date(Date.now() + tok.expires_in * 1000), refreshExpiresAt: tok.refresh_expires_in ? new Date(Date.now() + tok.refresh_expires_in * 1000) : creds.refreshExpiresAt };
  },
  async health(creds) { try { await call('/user/info/?fields=open_id', creds.accessToken, undefined, 'GET'); return { ok: true }; } catch (e: any) { return { ok: false, reason: e.message }; } },
  publishBudget(target) { return [{ key: `tt:${target.channelId}:posts`, limit: 15, windowSec: 86400 }, { key: 'tt:app:init', limit: 6, windowSec: 60 }]; },

  async lookup(creds, _ch, what) {
    if (what === 'creatorInfo') return creatorInfo(creds.accessToken);
    return null;
  },

  async publish({ target, channel, creds }) {
    const md = (target.metadata ?? {}) as any, media = (target.media as unknown as MediaRef[]) ?? [], tok = creds.accessToken;
    const ci = await creatorInfo(tok);
    if (!ci.privacy_level_options?.length) throw new ConnectorError('RATE_LIMIT', 'TikTok daily posting limit reached for this creator', { retryable: true, retryAfterMs: 3600_000 });
    if (!ci.privacy_level_options.includes(md.privacyLevel)) throw new ConnectorError('VALIDATION', `Privacy level "${md.privacyLevel}" is not available for this TikTok account — choose one of ${ci.privacy_level_options.join(', ')}`, { retryable: false });
    const postInfo = { title: target.text.slice(0, 2200), privacy_level: md.privacyLevel, disable_duet: !!md.disableDuet || ci.duet_disabled, disable_comment: !!md.disableComment || ci.comment_disabled, disable_stitch: !!md.disableStitch || ci.stitch_disabled, video_cover_timestamp_ms: media[0]?.cover?.offsetMs ?? 1000, brand_content_toggle: !!md.brandContent, brand_organic_toggle: !!md.brandOrganic, is_aigc: !!md.aiGenerated };

    let publishId: string;
    if (media[0]?.kind === 'video') {
      if ((media[0].durationMs ?? 0) > ci.max_video_post_duration_sec * 1000) throw new ConnectorError('VALIDATION', `Video is longer than this account's TikTok limit (${ci.max_video_post_duration_sec}s)`, { retryable: false });
      const init = await call('/post/publish/video/init/', tok, { post_info: postInfo, source_info: { source: 'PULL_FROM_URL', video_url: await mediaUrl(media[0], 'tt_video', { ttlSec: 7200 }) } });
      publishId = init.data.publish_id;
    } else {
      const init = await call('/post/publish/content/init/', tok, { media_type: 'PHOTO', post_mode: 'DIRECT_POST', post_info: { title: (md.photoTitle ?? target.text).slice(0, 90), description: target.text.slice(0, 4000), privacy_level: md.privacyLevel, disable_comment: postInfo.disable_comment, auto_add_music: md.autoAddMusic ?? true, brand_content_toggle: postInfo.brand_content_toggle, brand_organic_toggle: postInfo.brand_organic_toggle }, source_info: { source: 'PULL_FROM_URL', photo_cover_index: 0, photo_images: await Promise.all(media.slice(0, 35).map(m => mediaUrl(m, 'tt_photo', { ttlSec: 7200 }))) } });
      publishId = init.data.publish_id;
    }
    const t0 = Date.now();
    while (Date.now() - t0 < 30 * 60_000) {
      const s = await call('/post/publish/status/fetch/', tok, { publish_id: publishId });
      const st = s.data.status;
      if (st === 'PUBLISH_COMPLETE') { const pid = s.data.publicaly_available_post_id?.[0]; return { externalId: pid ?? publishId, url: pid ? `https://www.tiktok.com/@${channel.handle ?? '_'}/video/${pid}` : undefined, extra: { publishId, pending: !pid } }; }
      if (st === 'FAILED') { const r = s.data.fail_reason ?? 'unknown'; throw new ConnectorError(/spam_risk/.test(r) ? 'RATE_LIMIT' : /internal/.test(r) ? 'PLATFORM' : 'MEDIA', `TikTok: ${r.replace(/_/g, ' ')}`, { retryable: /internal|spam_risk/.test(r), raw: s }); }
      await sleep(15_000);
    }
    return { externalId: publishId, extra: { publishId, pending: true } };
  },

  async listRecentPosts(creds) {
    const r = await call('/video/list/?fields=id,create_time,share_url,video_description,cover_image_url', creds.accessToken, { max_count: 20 }).catch(() => ({ data: { videos: [] } }));
    return (r.data?.videos ?? []).map((v: any) => ({ externalId: v.id, text: v.video_description, url: v.share_url, createdAt: new Date(v.create_time * 1000), mediaUrl: v.cover_image_url }));
  },
  async collectPostMetrics({ creds, externalPostIds }) {
    const out: { externalPostId: string; metric: string; value: number }[] = [];
    for (const chunk of chunks(externalPostIds.filter(id => /^\d+$/.test(id)), 20)) {
      const r = await call('/video/query/?fields=id,like_count,comment_count,share_count,view_count', creds.accessToken, { filters: { video_ids: chunk } }).catch(() => ({ data: { videos: [] } }));
      for (const v of r.data?.videos ?? []) out.push({ externalPostId: v.id, metric: 'likes', value: v.like_count ?? 0 }, { externalPostId: v.id, metric: 'comments', value: v.comment_count ?? 0 }, { externalPostId: v.id, metric: 'shares', value: v.share_count ?? 0 }, { externalPostId: v.id, metric: 'video_views', value: v.view_count ?? 0 });
    }
    return out;
  },
  async collectChannelMetrics({ creds, until }) {
    const me = await call('/user/info/?fields=follower_count,likes_count,video_count', creds.accessToken, undefined, 'GET');
    const u = me.data.user, d = until.toISOString().slice(0, 10);
    return [{ day: d, metric: 'followers', value: u.follower_count ?? 0 }, { day: d, metric: 'likes_total', value: u.likes_count ?? 0 }];
  },

  verifyWebhook(req) {
    const sig = req.headers['tiktok-signature'] ?? '';
    const t = /t=(\d+)/.exec(sig)?.[1], s = /s=([a-f0-9]+)/.exec(sig)?.[1];
    if (!t || !s || Math.abs(Date.now() / 1000 - Number(t)) > 300) return { ok: false };
    return { ok: safeEqual(hmacHex(env.TT_CLIENT_SECRET ?? '', `${t}.${req.rawBody.toString('utf8')}`), s) };
  },
  parseWebhook(body) {
    const c = typeof body.content === 'string' ? safeParse(body.content) : body.content ?? {};
    if (body.event === 'authorization.removed') return [{ externalChannelId: body.user_openid, kind: 'permissions', raw: body }];
    if (String(body.event ?? '').startsWith('post.publish.')) return [{ externalChannelId: body.user_openid, kind: 'publish', raw: { event: body.event, publishId: c.publish_id, postId: c.post_id, reason: c.reason } }];
    return [];
  },
};

const safeParse = (s: string) => { try { return JSON.parse(s); } catch { return {}; } };
async function creatorInfo(tok: string): Promise<CreatorInfo> { const r = await call('/post/publish/creator_info/query/', tok, {}); return r.data; }
async function token(form: Record<string, string>) {
  const r = await http(`${TT}/oauth/token/`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ ...form, client_key: env.TT_CLIENT_KEY!, client_secret: env.TT_CLIENT_SECRET! }) });
  const j: any = await readJson(r);
  if (j.error && j.error !== 'ok') throw new ConnectorError('AUTH', j.error_description ?? j.error, { retryable: false, raw: j });
  if (!j.access_token) throw new ConnectorError('AUTH', 'TikTok token exchange failed', { retryable: false, raw: j });
  return j;
}
async function call(path: string, tok: string, body?: any, method: 'POST' | 'GET' = 'POST') {
  const r = await http(TT + path, { method, headers: { Authorization: `Bearer ${tok}`, 'content-type': 'application/json; charset=UTF-8' }, body: body ? JSON.stringify(body) : undefined });
  const j: any = await readJson(r);
  const code = j.error?.code;
  if (code && code !== 'ok') {
    const msg = j.error.message ?? code;
    if (['access_token_invalid', 'scope_not_authorized', 'scope_permission_missed'].includes(code)) throw new ConnectorError('AUTH', msg, { retryable: false, raw: j });
    if (['rate_limit_exceeded', 'spam_risk_too_many_posts', 'spam_risk_too_many_pending_share', 'spam_risk_user_banned_from_posting'].includes(code)) throw new ConnectorError(code === 'spam_risk_user_banned_from_posting' ? 'POLICY' : 'RATE_LIMIT', msg, { retryable: code !== 'spam_risk_user_banned_from_posting', retryAfterMs: 15 * 60_000, raw: j });
    if (code === 'unaudited_client_can_only_post_to_private_accounts') throw new ConnectorError('POLICY', 'TikTok app not yet audited: only private posts to private accounts are allowed', { retryable: false, raw: j });
    if (code === 'url_ownership_unverified') throw new ConnectorError('POLICY', 'Media domain is not verified in the TikTok developer portal', { retryable: false, raw: j });
    throw new ConnectorError(r.status >= 500 ? 'PLATFORM' : 'VALIDATION', msg, { retryable: r.status >= 500, raw: j });
  }
  if (!r.ok) throw new ConnectorError(r.status >= 500 ? 'PLATFORM' : 'VALIDATION', `TikTok HTTP ${r.status}`, { retryable: r.status >= 500, raw: j });
  return j;
}
