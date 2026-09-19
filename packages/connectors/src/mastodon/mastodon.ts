import { env } from '@cadence/config';
import { prismaAdmin } from '@cadence/db';
import { mastodonRules } from '@cadence/network-rules';
import type { SocialConnector, MediaRef, InboxItem } from '../types.js';
import { ConnectorError, http, readJson, pkce, newState, streamFromS3, sleep } from '../shared/index.js';

const SCOPES = 'read:accounts read:statuses read:notifications write:statuses write:media write:favourites';
interface Part { text: string; media: MediaRef[] }

export function normalizeHost(input: string) {
  const s = input.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  const at = s.split('@').filter(Boolean);           // "@me@host" → host
  const host = at.length > 1 ? at[at.length - 1] : s;
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(host)) throw new ConnectorError('VALIDATION', 'Enter your Mastodon server, e.g. mastodon.social', { retryable: false });
  return host.toLowerCase();
}

async function appFor(host: string) {
  const cached = await prismaAdmin.mastodonApp.findUnique({ where: { host } });
  if (cached) return cached;
  const res = await http(`https://${host}/api/v1/apps`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_name: 'Cadence', redirect_uris: [`${env.API_URL}/oauth/MASTODON/callback`], scopes: SCOPES, website: env.APP_URL }) });
  const j: any = await readJson(res);
  if (!j.client_id) throw new ConnectorError('PLATFORM', `Could not register app on ${host}`, { retryable: true, raw: j });
  return prismaAdmin.mastodonApp.create({ data: { host, clientId: j.client_id, clientSecret: j.client_secret } });
}

export const mastodon: SocialConnector = {
  network: 'MASTODON',
  rules: mastodonRules,

  async authStart({ hint, redirectUri }) {
    if (!hint) throw new ConnectorError('VALIDATION', 'Mastodon server is required', { retryable: false });
    const host = normalizeHost(hint); const app = await appFor(host); const state = newState(); const { verifier, challenge } = pkce();
    return { url: `https://${host}/oauth/authorize?` + new URLSearchParams({ response_type: 'code', client_id: app.clientId, redirect_uri: redirectUri, scope: SCOPES, state, code_challenge: challenge, code_challenge_method: 'S256' }), state, codeVerifier: verifier, extra: { host } };
  },
  async authCallback({ code, redirectUri, codeVerifier, extra }) {
    const host = extra.host; const app = await appFor(host);
    const tokRes = await http(`https://${host}/oauth/token`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ grant_type: 'authorization_code', code, client_id: app.clientId, client_secret: app.clientSecret, redirect_uri: redirectUri, scope: SCOPES, code_verifier: codeVerifier }) });
    const tok: any = await readJson(tokRes);
    if (!tok.access_token) throw new ConnectorError('AUTH', tok.error_description ?? 'Mastodon token exchange failed', { retryable: false, raw: tok });
    const me = await get(host, '/api/v1/accounts/verify_credentials', tok.access_token);
    const inst = await get(host, '/api/v2/instance', tok.access_token).catch(() => ({}));
    const cfg = inst.configuration ?? {};
    return {
      creds: { accessToken: tok.access_token, refreshToken: tok.refresh_token, tokenType: 'bearer', accessExpiresAt: tok.expires_in ? new Date(Date.now() + tok.expires_in * 1000) : undefined, scopes: SCOPES.split(' '), extra: { host } },
      candidates: [{ externalId: `${me.acct}@${host}`, subtype: 'account', displayName: me.display_name || me.username, handle: `@${me.acct}@${host}`, avatarUrl: me.avatar, meta: { host, accountId: me.id, maxChars: cfg.statuses?.max_characters ?? 500, maxMedia: cfg.statuses?.max_media_attachments ?? 4, charsPerUrl: cfg.statuses?.characters_reserved_per_url ?? 23, imageSizeLimit: cfg.media_attachments?.image_size_limit, videoSizeLimit: cfg.media_attachments?.video_size_limit, pollMaxOptions: cfg.polls?.max_options ?? 4, version: inst.version } }],
    };
  },
  async refresh(creds) {
    if (!creds.refreshToken) return creds;
    const app = await appFor(creds.extra.host);
    const tok: any = await readJson(await http(`https://${creds.extra.host}/oauth/token`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ grant_type: 'refresh_token', refresh_token: creds.refreshToken, client_id: app.clientId, client_secret: app.clientSecret }) }));
    if (!tok.access_token) throw new ConnectorError('AUTH', 'Mastodon refresh failed', { retryable: false, raw: tok });
    return { ...creds, accessToken: tok.access_token, refreshToken: tok.refresh_token ?? creds.refreshToken, accessExpiresAt: tok.expires_in ? new Date(Date.now() + tok.expires_in * 1000) : undefined };
  },
  async health(creds) { try { await get(creds.extra.host, '/api/v1/accounts/verify_credentials', creds.accessToken); return { ok: true }; } catch (e: any) { return { ok: false, reason: e.message }; } },
  publishBudget(target) { return [{ key: `masto:${target.channelId}:posts`, limit: 100, windowSec: 86400 }, { key: `masto:${target.channelId}:req`, limit: 280, windowSec: 300 }]; },

  async publish({ target, channel, creds, idempotencyKey }) {
    const host = creds.extra.host, md = (target.metadata ?? {}) as any, meta = (channel.meta ?? {}) as any;
    const parts: Part[] = [{ text: target.text, media: (target.media as unknown as MediaRef[]) ?? [] }, ...(((target.thread as any[]) ?? []) as Part[])];
    let prev: string | undefined, rootId: string | undefined, url: string | undefined;
    for (const [i, p] of parts.entries()) {
      const mediaIds: string[] = [];
      for (const m of p.media.slice(0, meta.maxMedia ?? 4)) {
        const src = await streamFromS3(m, m.kind === 'video' ? 'masto_video' : 'masto_image');
        const fd = new FormData(); fd.set('file', new Blob([new Uint8Array(await src.bytes)], { type: src.mime }), m.kind === 'video' ? 'video.mp4' : 'image.jpg'); if (m.altText) fd.set('description', m.altText.slice(0, 1500));
        const res = await http(`https://${host}/api/v2/media`, { method: 'POST', headers: { Authorization: `Bearer ${creds.accessToken}` }, body: fd, timeoutMs: 5 * 60_000 });
        const j: any = await readJson(res);
        if (!res.ok) throw new ConnectorError('MEDIA', j.error ?? 'Mastodon media upload failed', { retryable: res.status >= 500, raw: j });
        if (res.status === 202) { const t0 = Date.now(); while (Date.now() - t0 < 5 * 60_000) { const s = await http(`https://${host}/api/v1/media/${j.id}`, { headers: { Authorization: `Bearer ${creds.accessToken}` } }); if (s.status === 200) break; await sleep(3000); } }
        mediaIds.push(j.id);
      }
      const body: any = { status: p.text, media_ids: mediaIds, visibility: i === 0 ? (md.visibility ?? 'public') : (md.threadVisibility ?? md.visibility ?? 'public'), sensitive: !!md.sensitive || !!md.spoilerText, spoiler_text: md.spoilerText ?? '', language: md.language, in_reply_to_id: prev };
      if (i === 0 && md.poll && !mediaIds.length) body.poll = { options: md.poll.options, expires_in: md.poll.expiresInSec ?? 86400, multiple: !!md.poll.multiple };
      const res = await http(`https://${host}/api/v1/statuses`, { method: 'POST', headers: { Authorization: `Bearer ${creds.accessToken}`, 'content-type': 'application/json', 'Idempotency-Key': `${idempotencyKey}:${i}` }, body: JSON.stringify(body) });
      const j: any = await readJson(res);
      if (!res.ok) throw mErr(res.status, j);
      if (i === 0) { rootId = j.id; url = j.url; }
      prev = j.id;
    }
    return { externalId: rootId!, url };
  },
  async deletePost(creds, _ch, id) { await http(`https://${creds.extra.host}/api/v1/statuses/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${creds.accessToken}` } }); },
  async collectPostMetrics({ creds, externalPostIds }) {
    const out: { externalPostId: string; metric: string; value: number }[] = [];
    for (const id of externalPostIds) { const s = await get(creds.extra.host, `/api/v1/statuses/${id}`, creds.accessToken).catch(() => null); if (!s) continue; out.push({ externalPostId: id, metric: 'likes', value: s.favourites_count ?? 0 }, { externalPostId: id, metric: 'shares', value: s.reblogs_count ?? 0 }, { externalPostId: id, metric: 'comments', value: s.replies_count ?? 0 }); }
    return out;
  },
  async collectChannelMetrics({ creds, until }) { const me = await get(creds.extra.host, '/api/v1/accounts/verify_credentials', creds.accessToken); return [{ day: until.toISOString().slice(0, 10), metric: 'followers', value: me.followers_count ?? 0 }]; },
  async listRecentPosts(creds, channel, since) {
    const r = await get(creds.extra.host, `/api/v1/accounts/${(channel.meta as any).accountId}/statuses?limit=40&exclude_replies=true&exclude_reblogs=true`, creds.accessToken).catch(() => []);
    return (r as any[]).filter(s => Date.parse(s.created_at) >= since.getTime()).map(s => ({ externalId: s.id, text: htmlToText(s.content), url: s.url, createdAt: new Date(s.created_at) }));
  },
  async pollInbox(creds, _ch, cursor) {
    const q = new URLSearchParams({ limit: '80' }); q.append('types[]', 'mention'); if (cursor) q.set('since_id', cursor);
    const r: any[] = await get(creds.extra.host, `/api/v1/notifications?${q}`, creds.accessToken);
    const items: InboxItem[] = r.filter(n => n.status).map(n => ({ externalId: n.status.id, parentExternalId: n.status.in_reply_to_id ?? undefined, externalPostId: n.status.in_reply_to_id ?? n.status.id, kind: n.status.in_reply_to_id ? 'COMMENT' : 'MENTION', author: { id: n.account.id, name: n.account.display_name, handle: `@${n.account.acct}`, avatarUrl: n.account.avatar }, text: htmlToText(n.status.content), createdAt: new Date(n.created_at), likeCount: n.status.favourites_count, raw: n }));
    return { items, cursor: r[0]?.id ?? cursor };
  },
  async reply(creds, _ch, item, text) {
    const raw = item.raw; const mention = raw?.account?.acct ? `@${raw.account.acct} ` : '';
    const res = await http(`https://${creds.extra.host}/api/v1/statuses`, { method: 'POST', headers: { Authorization: `Bearer ${creds.accessToken}`, 'content-type': 'application/json' }, body: JSON.stringify({ status: mention + text, in_reply_to_id: item.externalId, visibility: raw?.status?.visibility ?? 'public' }) });
    const j: any = await readJson(res); if (!res.ok) throw mErr(res.status, j);
    return { externalId: j.id };
  },
  async like(creds, _ch, item) { await http(`https://${creds.extra.host}/api/v1/statuses/${item.externalId}/favourite`, { method: 'POST', headers: { Authorization: `Bearer ${creds.accessToken}` } }); },
};

async function get(host: string, path: string, tok: string) { const res = await http(`https://${host}${path}`, { headers: { Authorization: `Bearer ${tok}` } }); const j: any = await readJson(res); if (!res.ok) throw mErr(res.status, j); return j; }
function mErr(status: number, j: any) {
  if (status === 401) return new ConnectorError('AUTH', j.error ?? 'Mastodon token revoked', { retryable: false, raw: j });
  if (status === 429) return new ConnectorError('RATE_LIMIT', 'Mastodon rate limit', { retryable: true, retryAfterMs: 5 * 60_000, raw: j });
  if (status === 422) return new ConnectorError('VALIDATION', j.error ?? 'Rejected by the instance', { retryable: false, raw: j });
  return new ConnectorError(status >= 500 ? 'PLATFORM' : 'VALIDATION', j.error ?? `HTTP ${status}`, { retryable: status >= 500, raw: j });
}
export const htmlToText = (html: string) => String(html ?? '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n\n').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
