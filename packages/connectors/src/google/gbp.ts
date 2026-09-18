import { gbpRules } from '@cadence/network-rules';
import type { SocialConnector, MediaRef, InboxItem } from '../types.js';
import { ConnectorError, http, readJson, mediaUrl, ymd, hm } from '../shared/index.js';
import { googleAuthUrl, googleToken, gget, gpost, gdel, gErr } from './google-oauth.js';

const V4 = 'https://mybusiness.googleapis.com/v4';
const ACC = 'https://mybusinessaccountmanagement.googleapis.com/v1';
const INFO = 'https://mybusinessbusinessinformation.googleapis.com/v1';
const PERF = 'https://businessprofileperformance.googleapis.com/v1';
const SCOPE = 'https://www.googleapis.com/auth/business.manage';
const STARS: Record<string, number> = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };
const PERF_METRICS = ['BUSINESS_IMPRESSIONS_DESKTOP_MAPS', 'BUSINESS_IMPRESSIONS_DESKTOP_SEARCH', 'BUSINESS_IMPRESSIONS_MOBILE_MAPS', 'BUSINESS_IMPRESSIONS_MOBILE_SEARCH', 'CALL_CLICKS', 'WEBSITE_CLICKS', 'BUSINESS_DIRECTION_REQUESTS', 'BUSINESS_CONVERSATIONS', 'BUSINESS_BOOKINGS'];
const PERF_MAP: Record<string, string> = { CALL_CLICKS: 'calls', WEBSITE_CLICKS: 'link_clicks', BUSINESS_DIRECTION_REQUESTS: 'directions', BUSINESS_CONVERSATIONS: 'messages', BUSINESS_BOOKINGS: 'bookings' };

export const gbp: SocialConnector = {
  network: 'GOOGLE_BUSINESS',
  rules: gbpRules,

  async authStart({ redirectUri }) { return googleAuthUrl(redirectUri, [SCOPE]); },
  async authCallback({ code, redirectUri, codeVerifier }) {
    const tok = await googleToken({ grant_type: 'authorization_code', code, redirect_uri: redirectUri, code_verifier: codeVerifier! });
    const accounts = await gget(`${ACC}/accounts`, tok.access_token).catch(() => ({ accounts: [] }));
    const candidates: any[] = [];
    for (const a of accounts.accounts ?? []) {
      const locs = await gget(`${INFO}/${a.name}/locations`, tok.access_token, { readMask: 'name,title,storefrontAddress,metadata', pageSize: '100' }).catch(() => ({ locations: [] }));
      for (const l of locs.locations ?? []) candidates.push({ externalId: `${a.name}/${l.name}`, subtype: 'location', displayName: l.title, handle: l.storefrontAddress?.locality, meta: { accountName: a.name, locationName: l.name, placeId: l.metadata?.placeId, mapsUri: l.metadata?.mapsUri, canPost: l.metadata?.hasVoiceOfMerchant !== false } });
    }
    if (!candidates.length) throw new ConnectorError('POLICY', 'No Google Business Profile locations found for this account (or API access not yet approved)', { retryable: false });
    return { creds: { accessToken: tok.access_token, refreshToken: tok.refresh_token, tokenType: 'bearer', accessExpiresAt: new Date(Date.now() + tok.expires_in * 1000), scopes: [SCOPE], extra: {} }, candidates };
  },
  async refresh(creds) { const tok = await googleToken({ grant_type: 'refresh_token', refresh_token: creds.refreshToken! }); return { ...creds, accessToken: tok.access_token, accessExpiresAt: new Date(Date.now() + tok.expires_in * 1000) }; },
  async health(creds, channel) { try { await gget(`${INFO}/${(channel.meta as any).locationName}`, creds.accessToken, { readMask: 'name' }); return { ok: true }; } catch (e: any) { return { ok: false, reason: e.message }; } },
  publishBudget(target) { return [{ key: `gbp:${target.channelId}:posts`, limit: 50, windowSec: 86400 }]; },

  async publish({ target, channel, creds }) {
    const md = (target.metadata ?? {}) as any, m = ((target.media as unknown as MediaRef[]) ?? [])[0];
    if (/(\+?\d[\d\s().-]{7,}\d)/.test(target.text)) throw new ConnectorError('VALIDATION', 'Google Business Profile rejects posts containing phone numbers', { retryable: false });
    const body: any = { languageCode: md.languageCode ?? 'en', summary: target.text.slice(0, 1500), topicType: md.topicType ?? 'STANDARD' };
    if (md.cta && md.cta.actionType && md.cta.actionType !== 'NONE') body.callToAction = { actionType: md.cta.actionType, ...(md.cta.actionType !== 'CALL' ? { url: md.cta.url } : {}) };
    if (md.topicType === 'EVENT' || md.topicType === 'OFFER') {
      const s = new Date(md.event.start), e = new Date(md.event.end);
      body.event = { title: String(md.event.title).slice(0, 58), schedule: { startDate: ymd(s), startTime: hm(s), endDate: ymd(e), endTime: hm(e) } };
    }
    if (md.topicType === 'OFFER') body.offer = { couponCode: md.offer?.couponCode, redeemOnlineUrl: md.offer?.redeemOnlineUrl, termsConditions: md.offer?.terms };
    if (m) body.media = [{ mediaFormat: m.kind === 'video' ? 'VIDEO' : 'PHOTO', sourceUrl: await mediaUrl(m, m.kind === 'video' ? 'gbp_video' : 'gbp_photo', { ttlSec: 7200 }) }];
    const r = await gpost(`${V4}/${channel.externalId}/localPosts`, creds.accessToken, body);
    if (r.state === 'REJECTED') throw new ConnectorError('POLICY', 'Google rejected the post (content policy)', { retryable: false, raw: r });
    return { externalId: r.name, url: r.searchUrl };
  },
  async deletePost(creds, _ch, name) { await gdel(`${V4}/${name}`, creds.accessToken); },

  async collectChannelMetrics({ channel, creds, since, until }) {
    const loc = (channel.meta as any).locationName;
    const s = ymd(since), u = ymd(until);
    const q = PERF_METRICS.map(mm => `dailyMetrics=${mm}`).join('&') + `&dailyRange.startDate.year=${s.year}&dailyRange.startDate.month=${s.month}&dailyRange.startDate.day=${s.day}&dailyRange.endDate.year=${u.year}&dailyRange.endDate.month=${u.month}&dailyRange.endDate.day=${u.day}`;
    const res = await http(`${PERF}/${loc}:fetchMultiDailyMetricsTimeSeries?${q}`, { headers: { Authorization: `Bearer ${creds.accessToken}` } });
    if (!res.ok) throw await gErr(res);
    const r: any = await readJson(res);
    const acc: Record<string, number> = {};
    for (const series of r.multiDailyMetricTimeSeries ?? []) for (const d of series.dailyMetricTimeSeries ?? []) for (const v of d.timeSeries?.datedValues ?? []) {
      const day = `${v.date.year}-${String(v.date.month).padStart(2, '0')}-${String(v.date.day).padStart(2, '0')}`;
      const metric = String(d.dailyMetric).startsWith('BUSINESS_IMPRESSIONS') ? 'impressions' : PERF_MAP[d.dailyMetric] ?? d.dailyMetric;
      acc[`${day}|${metric}`] = (acc[`${day}|${metric}`] ?? 0) + Number(v.value ?? 0);
    }
    return Object.entries(acc).map(([k, value]) => { const [day, metric] = k.split('|'); return { day, metric, value }; });
  },
  async pollInbox(creds, channel, cursor) {
    const r = await gget(`${V4}/${channel.externalId}/reviews`, creds.accessToken, { pageSize: '50', orderBy: 'updateTime desc' }).catch(() => ({ reviews: [] }));
    const since = cursor ? Date.parse(cursor) : 0;
    const items: InboxItem[] = (r.reviews ?? []).filter((x: any) => Date.parse(x.updateTime) > since).map((x: any) => ({
      externalId: x.name, kind: 'REVIEW' as const, author: { name: x.reviewer?.displayName, avatarUrl: x.reviewer?.profilePhotoUrl },
      text: `${'★'.repeat(STARS[x.starRating] ?? 0)}${x.comment ? ' ' + x.comment : ''}`.trim(), createdAt: new Date(x.createTime), isOurs: false, raw: x,
      ...(x.reviewReply ? { repliedAt: new Date(x.reviewReply.updateTime) } : {}),
    }));
    return { items, cursor: new Date().toISOString() };
  },
  async reply(creds, _ch, item, text) { await gpost(`${V4}/${item.externalId}/reply`, creds.accessToken, { comment: text.slice(0, 4096) }, 'PUT'); return { externalId: `${item.externalId}/reply` }; },
  parseWebhook(body) {
    // Pub/Sub push: { message: { data: base64 JSON { type, location, review } } }
    try {
      const data = JSON.parse(Buffer.from(body.message?.data ?? '', 'base64').toString('utf8'));
      if (data.type?.includes('REVIEW')) return [{ externalChannelId: data.location, kind: 'inbox', raw: data, items: [] }]; // ingest re-fetches the review by name (data.review)
    } catch { /* ignore */ }
    return [];
  },
};
