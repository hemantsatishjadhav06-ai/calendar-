import { env } from '@cadence/config';
import { pinterestRules } from '@cadence/network-rules';
import type { SocialConnector, MediaRef, Creds } from '../types.js';
import { ConnectorError, http, readJson, newState, assertConfigured, mediaUrl, streamFromS3, sleep } from '../shared/index.js';

const PIN = () => (env.PIN_SANDBOX ? 'https://api-sandbox.pinterest.com/v5' : 'https://api.pinterest.com/v5');
const SCOPES = ['boards:read', 'boards:write', 'boards:read_secret', 'pins:read', 'pins:write', 'pins:read_secret', 'pins:write_secret', 'user_accounts:read'];
const AMAP: Record<string, string> = { IMPRESSION: 'impressions', ENGAGEMENT: 'engagements', PIN_CLICK: 'clicks', OUTBOUND_CLICK: 'link_clicks', SAVE: 'saves', TOTAL_COMMENTS: 'comments', TOTAL_REACTIONS: 'likes' };

export const pinterest: SocialConnector = {
  network: 'PINTEREST',
  rules: pinterestRules,

  async authStart({ redirectUri }) {
    assertConfigured(['PIN_APP_ID', env.PIN_APP_ID]);
    const state = newState();
    return { url: 'https://www.pinterest.com/oauth/?' + new URLSearchParams({ client_id: env.PIN_APP_ID!, redirect_uri: redirectUri, response_type: 'code', scope: SCOPES.join(','), state }), state };
  },
  async authCallback({ code, redirectUri }) {
    const tok = await token({ grant_type: 'authorization_code', code, redirect_uri: redirectUri, continuous_refresh: 'true' });
    const creds = toCreds(tok, {});
    const me = await get('/user_account', creds.accessToken);
    return { creds, candidates: [{ externalId: me.id ?? me.username, subtype: me.account_type === 'BUSINESS' ? 'business' : 'personal', displayName: me.business_name ?? me.username, handle: me.username, avatarUrl: me.profile_image }] };
  },
  async refresh(creds) { const tok = await token({ grant_type: 'refresh_token', refresh_token: creds.refreshToken! }); return toCreds(tok, creds.extra); },
  async health(creds) { try { await get('/user_account', creds.accessToken); return { ok: true }; } catch (e: any) { return { ok: false, reason: e.message }; } },
  publishBudget(target) { return [{ key: `pin:${target.channelId}:write`, limit: 100, windowSec: 60 }, { key: `pin:${target.channelId}:daily`, limit: 25, windowSec: 86400 }]; },

  async lookup(creds, _ch, what) {
    if (what !== 'boards') return null;
    const out: any[] = []; let bookmark: string | undefined;
    do {
      const r = await get(`/boards?page_size=100&privacy=ALL${bookmark ? `&bookmark=${bookmark}` : ''}`, creds.accessToken);
      out.push(...(r.items ?? []).map((b: any) => ({ id: b.id, name: b.name, privacy: b.privacy, cover: b.media?.image_cover_url })));
      bookmark = r.bookmark;
    } while (bookmark && out.length < 1000);
    return out;
  },

  async publish({ target, creds }) {
    const md = (target.metadata ?? {}) as any, media = (target.media as unknown as MediaRef[]) ?? [];
    let media_source: any;
    if (media[0]?.kind === 'video') {
      const reg = await post('/media', creds.accessToken, { media_type: 'video' });
      const src = await streamFromS3(media[0], 'pin_video');
      const fd = new FormData();
      for (const [k, v] of Object.entries(reg.upload_parameters ?? {})) fd.set(k, String(v));
      fd.set('file', new Blob([new Uint8Array(await src.bytes)]), 'video.mp4');
      const up = await http(reg.upload_url, { method: 'POST', body: fd, timeoutMs: 10 * 60_000 });
      if (!up.ok) throw new ConnectorError('MEDIA', `Pinterest video upload failed (${up.status})`, { retryable: up.status >= 500 });
      const t0 = Date.now();
      while (Date.now() - t0 < 10 * 60_000) { const s = await get(`/media/${reg.media_id}`, creds.accessToken); if (s.status === 'succeeded') break; if (s.status === 'failed') throw new ConnectorError('MEDIA', 'Pinterest could not process the video', { retryable: false }); await sleep(5000); }
      media_source = { source_type: 'video_id', media_id: reg.media_id, ...(media[0].cover?.assetId ? { cover_image_url: await mediaUrl({ assetId: media[0].cover.assetId, kind: 'image' }, 'pin_image') } : { cover_image_key_frame_time: media[0].cover?.offsetMs ?? 1000 }) };
    } else if (media.length > 1) {
      media_source = { source_type: 'multiple_image_urls', items: await Promise.all(media.slice(0, 5).map(async m => ({ url: await mediaUrl(m, 'pin_image'), title: md.title, description: target.text.slice(0, 800), link: md.link }))), index: 0 };
    } else if (media[0]) {
      media_source = { source_type: 'image_url', url: await mediaUrl(media[0], 'pin_image'), is_standard: true };
    } else throw new ConnectorError('VALIDATION', 'Pinterest requires an image or video', { retryable: false });

    const pin = await post('/pins', creds.accessToken, { board_id: md.boardId, board_section_id: md.boardSectionId || undefined, title: (md.title ?? '').slice(0, 100) || undefined, description: target.text.slice(0, 800), link: md.link || undefined, alt_text: media[0]?.altText?.slice(0, 500), media_source });
    return { externalId: pin.id, url: `https://www.pinterest.com/pin/${pin.id}/` };
  },
  async deletePost(creds, _ch, id) { const r = await http(`${PIN()}/pins/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${creds.accessToken}` } }); if (!r.ok && r.status !== 404) throw await err(r); },

  async collectPostMetrics({ creds, externalPostIds }) {
    const out: { externalPostId: string; metric: string; value: number }[] = [];
    for (const id of externalPostIds) {
      const p = await get(`/pins/${id}?pin_metrics=true`, creds.accessToken).catch(() => null);
      const a = p?.pin_metrics?.all_time; if (!a) continue;
      out.push({ externalPostId: id, metric: 'impressions', value: a.impression ?? 0 }, { externalPostId: id, metric: 'saves', value: a.save ?? 0 }, { externalPostId: id, metric: 'clicks', value: a.pin_click ?? 0 }, { externalPostId: id, metric: 'link_clicks', value: a.outbound_click ?? 0 }, { externalPostId: id, metric: 'comments', value: a.total_comments ?? 0 }, { externalPostId: id, metric: 'likes', value: a.total_reactions ?? 0 });
    }
    return out;
  },
  async collectChannelMetrics({ creds, since, until }) {
    const rows: { day: string; metric: string; value: number }[] = [];
    const r = await get(`/user_account/analytics?start_date=${since.toISOString().slice(0, 10)}&end_date=${until.toISOString().slice(0, 10)}&metric_types=${Object.keys(AMAP).join(',')}&split_field=NO_SPLIT`, creds.accessToken).catch(() => null);
    for (const d of r?.all?.daily_metrics ?? []) if (d.data_status === 'READY') for (const [k, v] of Object.entries(d.metrics ?? {})) rows.push({ day: d.date, metric: AMAP[k] ?? k, value: Number(v) });
    const me = await get('/user_account', creds.accessToken).catch(() => ({}));
    const day = until.toISOString().slice(0, 10);
    if (me.follower_count != null) rows.push({ day, metric: 'followers', value: me.follower_count });
    if (me.monthly_views != null) rows.push({ day, metric: 'monthly_views', value: me.monthly_views });
    return rows;
  },
  async listRecentPosts(creds, _ch, since) {
    const r = await get('/pins?page_size=50', creds.accessToken).catch(() => ({ items: [] }));
    return (r.items ?? []).filter((p: any) => Date.parse(p.created_at) >= since.getTime()).map((p: any) => ({ externalId: p.id, text: p.title ?? p.description, url: `https://www.pinterest.com/pin/${p.id}/`, createdAt: new Date(p.created_at), mediaUrl: p.media?.images?.['400x300']?.url }));
  },
};

const toCreds = (tok: any, extra: any): Creds => ({ accessToken: tok.access_token, refreshToken: tok.refresh_token, tokenType: 'bearer', accessExpiresAt: new Date(Date.now() + tok.expires_in * 1000), refreshExpiresAt: new Date(Date.now() + (tok.refresh_token_expires_in ?? 5184000) * 1000), scopes: String(tok.scope ?? '').split(/[ ,]/).filter(Boolean), extra: extra ?? {} });
async function token(form: Record<string, string>) {
  const r = await http(`${PIN()}/oauth/token`, { method: 'POST', headers: { Authorization: 'Basic ' + Buffer.from(`${env.PIN_APP_ID}:${env.PIN_APP_SECRET}`).toString('base64'), 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(form) });
  const j: any = await readJson(r);
  if (!r.ok) throw new ConnectorError('AUTH', j.message ?? j.error ?? 'Pinterest token error', { retryable: false, raw: j });
  return j;
}
async function get(path: string, tok: string) { const r = await http(PIN() + path, { headers: { Authorization: `Bearer ${tok}` } }); if (!r.ok) throw await err(r); return readJson(r); }
async function post(path: string, tok: string, body: any) { const r = await http(PIN() + path, { method: 'POST', headers: { Authorization: `Bearer ${tok}`, 'content-type': 'application/json' }, body: JSON.stringify(body) }); if (!r.ok) throw await err(r); return readJson(r); }
async function err(r: Response) {
  const j: any = await readJson(r);
  if (r.status === 401 || j.code === 2) return new ConnectorError('AUTH', 'Pinterest authentication failed', { retryable: false, raw: j });
  if (r.status === 429 || j.code === 3) return new ConnectorError('RATE_LIMIT', 'Pinterest rate limit', { retryable: true, retryAfterMs: Math.max(60_000, Number(r.headers.get('x-ratelimit-reset') ?? 0) * 1000), raw: j });
  if (r.status === 403 && j.code === 29) return new ConnectorError('POLICY', 'Pinterest app lacks access (trial tier or missing scope)', { retryable: false, raw: j });
  if (r.status === 403) return new ConnectorError('MEDIA', j.message ?? 'Pinterest rejected the media', { retryable: false, raw: j });
  return new ConnectorError(r.status >= 500 ? 'PLATFORM' : 'VALIDATION', j.message ?? r.statusText, { retryable: r.status >= 500, raw: j });
}
