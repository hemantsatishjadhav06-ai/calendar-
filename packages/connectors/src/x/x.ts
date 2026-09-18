import twitter from 'twitter-text';
import { env } from '@relay/config';
import { prismaAdmin } from '@relay/db';
import { xRules } from '@relay/network-rules';
import type { SocialConnector, MediaRef, InboxItem } from '../types.js';
import { ConnectorError, http, readJson, pkce, newState, assertConfigured, streamFromS3, chunkStream, sleep, chunks, hmacB64, safeEqual } from '../shared/index.js';

const X = 'https://api.x.com/2';
const SCOPES = ['tweet.read', 'tweet.write', 'tweet.moderate.write', 'users.read', 'offline.access', 'media.write'];
interface Part { text: string; media: MediaRef[] }

export const POST_COST_USD = 0.015, POST_WITH_URL_COST_USD = 0.20, REPLY_COST_USD = 0.01, DELETE_COST_USD = 0.01;

export const x: SocialConnector = {
  network: 'X',
  rules: xRules,

  async authStart({ redirectUri }) {
    assertConfigured(['X_CLIENT_ID', env.X_CLIENT_ID]);
    const state = newState(); const { verifier, challenge } = pkce();
    const url = 'https://x.com/i/oauth2/authorize?' + new URLSearchParams({ response_type: 'code', client_id: env.X_CLIENT_ID!, redirect_uri: redirectUri, scope: SCOPES.join(' '), state, code_challenge: challenge, code_challenge_method: 'S256' });
    return { url, state, codeVerifier: verifier };
  },
  async authCallback({ code, redirectUri, codeVerifier }) {
    const tok = await token({ grant_type: 'authorization_code', code, redirect_uri: redirectUri, code_verifier: codeVerifier!, client_id: env.X_CLIENT_ID! });
    const me = await get('/users/me', tok.access_token, { 'user.fields': 'id,name,username,profile_image_url,verified_type,subscription_type,public_metrics' });
    const premium = !!me.data.subscription_type && me.data.subscription_type !== 'None';
    return {
      creds: { accessToken: tok.access_token, refreshToken: tok.refresh_token, tokenType: 'bearer', accessExpiresAt: new Date(Date.now() + tok.expires_in * 1000), scopes: String(tok.scope ?? '').split(' '), extra: { userId: me.data.id, premium } },
      candidates: [{ externalId: me.data.id, subtype: 'profile', displayName: me.data.name, handle: me.data.username, avatarUrl: me.data.profile_image_url?.replace('_normal', '_400x400'), meta: { premium, subscriptionType: me.data.subscription_type } }],
    };
  },
  async refresh(creds) {
    if (!creds.refreshToken) throw new ConnectorError('AUTH', 'X session expired — reconnect', { retryable: false });
    const tok = await token({ grant_type: 'refresh_token', refresh_token: creds.refreshToken, client_id: env.X_CLIENT_ID! });
    return { ...creds, accessToken: tok.access_token, refreshToken: tok.refresh_token ?? creds.refreshToken, accessExpiresAt: new Date(Date.now() + tok.expires_in * 1000) };
  },
  async health(creds) { try { await get('/users/me', creds.accessToken, {}); return { ok: true }; } catch (e: any) { return { ok: false, reason: e.message }; } },

  publishBudget(target) {
    const n = 1 + (((target.thread as any[]) ?? []).length);
    return [{ key: `x:${target.channelId}:posts`, limit: 100, windowSec: 900, cost: n }, { key: 'x:app:posts', limit: 10_000, windowSec: 86400, cost: n }];
  },

  async publish({ target, channel, creds }) {
    const parts: Part[] = [{ text: target.text, media: (target.media as unknown as MediaRef[]) ?? [] }, ...(((target.thread as any[]) ?? []) as Part[])];
    const md = (target.metadata ?? {}) as any;
    await assertSpend(channel.organizationId, parts.reduce((s, p) => s + (/https?:\/\//.test(p.text) ? POST_WITH_URL_COST_USD : POST_COST_USD), 0));
    let prev: string | undefined, rootId: string | undefined;
    for (const [i, p] of parts.entries()) {
      const check = twitter.parseTweet(p.text);
      if (!check.valid && !creds.extra?.premium) throw new ConnectorError('VALIDATION', `Post ${i + 1} is ${check.weightedLength} weighted characters (max 280)`, { retryable: false });
      const mediaIds: string[] = [];
      for (const m of p.media) mediaIds.push(await uploadMedia(creds.accessToken, m));
      const body: any = { text: p.text };
      if (mediaIds.length) body.media = { media_ids: mediaIds };
      const tagged = p.media.flatMap(m => m.userTags?.map(u => u.id).filter(Boolean) ?? []);
      if (mediaIds.length && tagged.length) body.media.tagged_user_ids = tagged.slice(0, 10);
      if (prev) body.reply = { in_reply_to_tweet_id: prev };
      if (i === 0 && md.poll && !mediaIds.length) body.poll = { options: md.poll.options, duration_minutes: md.poll.durationMinutes ?? 1440 };
      if (i === 0 && md.replySettings) body.reply_settings = md.replySettings;
      if (i === 0 && md.quoteTweetId) body.quote_tweet_id = md.quoteTweetId;
      const r = await post('/tweets', creds.accessToken, body);
      await recordSpend(channel.organizationId, /https?:\/\//.test(p.text) ? POST_WITH_URL_COST_USD : POST_COST_USD, r.data.id);
      prev = r.data.id; if (i === 0) rootId = r.data.id;
    }
    return { externalId: rootId!, url: `https://x.com/${channel.handle ?? 'i'}/status/${rootId}` };
  },
  async deletePost(creds, ch, id) { await del(`/tweets/${id}`, creds.accessToken); await recordSpend(ch.organizationId, DELETE_COST_USD, id); },

  async collectPostMetrics({ creds, externalPostIds }) {
    const out: { externalPostId: string; metric: string; value: number }[] = [];
    for (const chunk of chunks(externalPostIds, 100)) {
      const r = await get('/tweets', creds.accessToken, { ids: chunk.join(','), 'tweet.fields': 'public_metrics,created_at' }).catch(() => ({ data: [] }));
      for (const t of r.data ?? []) {
        const m = t.public_metrics ?? {};
        out.push({ externalPostId: t.id, metric: 'likes', value: m.like_count ?? 0 }, { externalPostId: t.id, metric: 'comments', value: m.reply_count ?? 0 }, { externalPostId: t.id, metric: 'shares', value: m.retweet_count ?? 0 }, { externalPostId: t.id, metric: 'quotes', value: m.quote_count ?? 0 }, { externalPostId: t.id, metric: 'saves', value: m.bookmark_count ?? 0 }, { externalPostId: t.id, metric: 'impressions', value: m.impression_count ?? 0 });
      }
      const recent = (r.data ?? []).filter((t: any) => Date.now() - Date.parse(t.created_at) < 30 * 864e5).map((t: any) => t.id);
      if (recent.length) {
        const r2 = await get('/tweets', creds.accessToken, { ids: recent.join(','), 'tweet.fields': 'non_public_metrics' }).catch(() => ({ data: [] }));
        for (const t of r2.data ?? []) out.push({ externalPostId: t.id, metric: 'link_clicks', value: t.non_public_metrics?.url_link_clicks ?? 0 }, { externalPostId: t.id, metric: 'profile_clicks', value: t.non_public_metrics?.user_profile_clicks ?? 0 });
      }
    }
    return out;
  },
  async collectChannelMetrics({ creds, until }) {
    const me = await get('/users/me', creds.accessToken, { 'user.fields': 'public_metrics' });
    return [{ day: until.toISOString().slice(0, 10), metric: 'followers', value: me.data.public_metrics?.followers_count ?? 0 }];
  },
  async listRecentPosts(creds, channel, since) {
    const r = await get(`/users/${channel.externalId}/tweets`, creds.accessToken, { max_results: 50, exclude: 'replies,retweets', start_time: since.toISOString(), 'tweet.fields': 'created_at' }).catch(() => ({ data: [] }));
    return (r.data ?? []).map((t: any) => ({ externalId: t.id, text: t.text, url: `https://x.com/${channel.handle}/status/${t.id}`, createdAt: new Date(t.created_at) }));
  },

  async pollInbox(creds, channel, cursor) {
    const r = await get(`/users/${channel.externalId}/mentions`, creds.accessToken, { max_results: 100, ...(cursor ? { since_id: cursor } : {}), 'tweet.fields': 'author_id,created_at,conversation_id,in_reply_to_user_id,referenced_tweets,public_metrics', expansions: 'author_id', 'user.fields': 'name,username,profile_image_url' });
    const users = Object.fromEntries(((r.includes?.users ?? []) as any[]).map(u => [u.id, u]));
    const items: InboxItem[] = (r.data ?? []).map((t: any) => {
      const u = users[t.author_id]; const repliedTo = t.referenced_tweets?.find((x: any) => x.type === 'replied_to')?.id;
      return { externalId: t.id, parentExternalId: repliedTo, externalPostId: t.conversation_id, kind: repliedTo ? 'REPLY' : 'MENTION', author: { id: t.author_id, name: u?.name, handle: u?.username, avatarUrl: u?.profile_image_url }, text: t.text, createdAt: new Date(t.created_at), likeCount: t.public_metrics?.like_count, raw: t } as InboxItem;
    });
    return { items, cursor: r.meta?.newest_id ?? cursor };
  },
  async reply(creds, ch, item, text) { const r = await post('/tweets', creds.accessToken, { text, reply: { in_reply_to_tweet_id: item.externalId } }); await recordSpend(ch.organizationId, REPLY_COST_USD, r.data.id); return { externalId: r.data.id }; },
  async hide(creds, _ch, item, hidden) { const res = await http(`${X}/tweets/${item.externalId}/hidden`, { method: 'PUT', headers: { Authorization: `Bearer ${creds.accessToken}`, 'content-type': 'application/json' }, body: JSON.stringify({ hidden }) }); await json(res); },
  async like(creds, ch, item) {
    // Likes were removed from self-serve tiers in Apr 2026; keep the call for Enterprise apps and surface a clean error otherwise.
    await post(`/users/${ch.externalId}/likes`, creds.accessToken, { tweet_id: item.externalId });
  },

  verifyWebhook(req) {
    if (req.query.crc_token) return { ok: true, challengeResponse: JSON.stringify({ response_token: 'sha256=' + hmacB64(env.X_CONSUMER_SECRET ?? '', req.query.crc_token) }), contentType: 'application/json' };
    const expected = 'sha256=' + hmacB64(env.X_CONSUMER_SECRET ?? '', req.rawBody);
    return { ok: safeEqual(req.headers['x-twitter-webhooks-signature'] ?? '', expected) };
  },
  parseWebhook(body) {
    const uid = body.for_user_id; const out: any[] = [];
    for (const t of body.tweet_create_events ?? []) {
      if (t.user?.id_str === uid) continue;
      out.push({ externalChannelId: uid, kind: 'inbox', raw: t, items: [{ externalId: t.id_str, parentExternalId: t.in_reply_to_status_id_str ?? undefined, externalPostId: t.in_reply_to_status_id_str ?? t.id_str, kind: t.in_reply_to_status_id_str ? 'REPLY' : 'MENTION', author: { id: t.user.id_str, name: t.user.name, handle: t.user.screen_name, avatarUrl: t.user.profile_image_url_https }, text: t.extended_tweet?.full_text ?? t.text, createdAt: new Date(t.created_at), raw: t }] });
    }
    for (const d of body.direct_message_events ?? []) {
      if (d.message_create?.sender_id === uid) continue;
      out.push({ externalChannelId: uid, kind: 'inbox', raw: d, items: [{ externalId: d.id, kind: 'DM', author: { id: d.message_create?.sender_id }, text: d.message_create?.message_data?.text ?? '', createdAt: new Date(Number(d.created_timestamp)), raw: d }] });
    }
    if (body.user_event?.revoke) out.push({ externalChannelId: uid, kind: 'permissions', raw: body.user_event });
    return out;
  },
};

// ---- helpers
async function token(form: Record<string, string>) {
  const basic = Buffer.from(`${env.X_CLIENT_ID}:${env.X_CLIENT_SECRET}`).toString('base64');
  const res = await http(`${X}/oauth2/token`, { method: 'POST', headers: { Authorization: `Basic ${basic}`, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(form) });
  const j: any = await readJson(res);
  if (!res.ok) throw new ConnectorError(['invalid_grant', 'invalid_request', 'invalid_client'].includes(j.error) ? 'AUTH' : 'PLATFORM', j.error_description ?? j.error ?? 'X token error', { retryable: false, raw: j });
  return j;
}
async function json(res: Response) {
  const j: any = await readJson(res);
  if (res.status === 401) throw new ConnectorError('AUTH', j.detail ?? 'Unauthorized', { retryable: false, raw: j });
  if (res.status === 429) throw new ConnectorError('RATE_LIMIT', 'X rate limit', { retryable: true, retryAfterMs: Math.max(60_000, Number(res.headers.get('x-rate-limit-reset')) * 1000 - Date.now()), raw: j });
  if (res.status === 402 || /credits|balance|payment/i.test(j.detail ?? '')) throw new ConnectorError('POLICY', 'X API credits depleted — top up in console.x.com', { retryable: true, retryAfterMs: 3600_000, raw: j });
  if (res.status === 403 && /too long/i.test(j.detail ?? '')) throw new ConnectorError('VALIDATION', j.detail, { retryable: false, raw: j });
  if (res.status === 403 && /duplicate/i.test(j.detail ?? '')) throw new ConnectorError('VALIDATION', 'X rejected a duplicate post', { retryable: false, raw: j });
  if (res.status === 403) throw new ConnectorError('POLICY', j.detail ?? j.title ?? 'Forbidden by X', { retryable: false, raw: j });
  if (!res.ok) throw new ConnectorError(res.status >= 500 ? 'PLATFORM' : 'VALIDATION', j.detail ?? j.title ?? res.statusText, { retryable: res.status >= 500, raw: j });
  return j;
}
async function get(path: string, tok: string, params: Record<string, any>) { const u = new URL(X + path); for (const [k, v] of Object.entries(params)) u.searchParams.set(k, String(v)); return json(await http(u, { headers: { Authorization: `Bearer ${tok}` } })); }
async function post(path: string, tok: string, body: any) { return json(await http(X + path, { method: 'POST', headers: { Authorization: `Bearer ${tok}`, 'content-type': 'application/json' }, body: JSON.stringify(body) })); }
async function del(path: string, tok: string) { return json(await http(X + path, { method: 'DELETE', headers: { Authorization: `Bearer ${tok}` } })); }

/** v2 chunked media upload: initialize → append (≤5 MB) → finalize → STATUS; alt text via /media/metadata. */
async function uploadMedia(tok: string, m: MediaRef): Promise<string> {
  const rendition = m.kind === 'video' ? 'x_video' : m.kind === 'gif' ? 'x_gif' : 'x_image';
  const src = await streamFromS3(m, rendition);
  const category = m.kind === 'video' ? 'tweet_video' : m.kind === 'gif' ? 'tweet_gif' : 'tweet_image';
  const init = await post('/media/upload/initialize', tok, { media_type: src.mime, total_bytes: src.size, media_category: category });
  const id = init.data.id; let idx = 0;
  for await (const chunk of chunkStream(src.stream, 5 * 1024 * 1024)) {
    const fd = new FormData(); fd.set('media', new Blob([new Uint8Array(chunk)]), 'chunk'); fd.set('segment_index', String(idx++));
    await json(await http(`${X}/media/upload/${id}/append`, { method: 'POST', headers: { Authorization: `Bearer ${tok}` }, body: fd }));
  }
  let fin = await post(`/media/upload/${id}/finalize`, tok, {});
  while (fin.data?.processing_info && !['succeeded', 'failed'].includes(fin.data.processing_info.state)) {
    await sleep((fin.data.processing_info.check_after_secs ?? 2) * 1000);
    fin = await get('/media/upload', tok, { command: 'STATUS', media_id: id });
  }
  if (fin.data?.processing_info?.state === 'failed') throw new ConnectorError('MEDIA', fin.data.processing_info.error?.message ?? 'X rejected the media', { retryable: false, raw: fin });
  if (m.altText) await post('/media/metadata', tok, { id, metadata: { alt_text: { text: m.altText.slice(0, 1000) } } }).catch(() => undefined);
  return id;
}

/** Per-organization X spend guard (pay-per-use). */
async function monthSpend(organizationId: string) {
  const start = new Date(); start.setUTCDate(1); start.setUTCHours(0, 0, 0, 0);
  const r = await prismaAdmin.spendLedger.aggregate({ where: { organizationId, provider: 'x', createdAt: { gte: start } }, _sum: { amountUsd: true } });
  return Number(r._sum.amountUsd ?? 0);
}
async function assertSpend(organizationId: string, add: number) {
  const cap = env.X_SPEND_CAP_USD_PER_ORG;
  if (cap > 0 && (await monthSpend(organizationId)) + add > cap) throw new ConnectorError('POLICY', `X spending cap of $${cap}/month reached for this organization`, { retryable: false });
}
async function recordSpend(organizationId: string, amountUsd: number, ref?: string) {
  await prismaAdmin.spendLedger.create({ data: { organizationId, provider: 'x', amountUsd, ref } }).catch(() => undefined);
}
