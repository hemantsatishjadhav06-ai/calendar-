import { env } from '@cadence/config';
import { youtubeRules } from '@cadence/network-rules';
import type { SocialConnector, MediaRef, InboxItem } from '../types.js';
import { createHmac } from 'node:crypto';
import { ConnectorError, http, readJson, streamFromS3, chunkStream, chunks, firstLine, safeEqual, log } from '../shared/index.js';
import { googleAuthUrl, googleToken, gget, gpost, gdel, gErr } from './google-oauth.js';

const YT = 'https://www.googleapis.com/youtube/v3';
const YTA = 'https://youtubeanalytics.googleapis.com/v2/reports';
const SCOPES = ['https://www.googleapis.com/auth/youtube.upload', 'https://www.googleapis.com/auth/youtube.force-ssl', 'https://www.googleapis.com/auth/youtube.readonly', 'https://www.googleapis.com/auth/yt-analytics.readonly'];
const AMAP: Record<string, string> = { views: 'video_views', estimatedMinutesWatched: 'watch_time_min', averageViewDuration: 'avg_view_duration_s', likes: 'likes', comments: 'comments', shares: 'shares', subscribersGained: 'follows', subscribersLost: 'unfollows' };

export const youtube: SocialConnector = {
  network: 'YOUTUBE',
  rules: youtubeRules,

  async authStart({ redirectUri }) { return googleAuthUrl(redirectUri, SCOPES); },
  async authCallback({ code, redirectUri, codeVerifier }) {
    const tok = await googleToken({ grant_type: 'authorization_code', code, redirect_uri: redirectUri, code_verifier: codeVerifier! });
    const ch = await gget(`${YT}/channels`, tok.access_token, { part: 'snippet,statistics,contentDetails', mine: 'true' });
    if (!ch.items?.length) throw new ConnectorError('POLICY', 'This Google account has no YouTube channel', { retryable: false });
    return {
      creds: { accessToken: tok.access_token, refreshToken: tok.refresh_token, tokenType: 'bearer', accessExpiresAt: new Date(Date.now() + tok.expires_in * 1000), scopes: String(tok.scope ?? '').split(' '), extra: {} },
      candidates: ch.items.map((c: any) => ({ externalId: c.id, subtype: 'channel', displayName: c.snippet.title, handle: c.snippet.customUrl, avatarUrl: c.snippet.thumbnails?.default?.url, meta: { uploadsPlaylist: c.contentDetails?.relatedPlaylists?.uploads } })),
    };
  },
  async refresh(creds) { const tok = await googleToken({ grant_type: 'refresh_token', refresh_token: creds.refreshToken! }); return { ...creds, accessToken: tok.access_token, accessExpiresAt: new Date(Date.now() + tok.expires_in * 1000) }; },
  async health(creds, channel) { try { const r = await gget(`${YT}/channels`, creds.accessToken, { part: 'id', id: channel.externalId }); return { ok: (r.items ?? []).length > 0, reason: r.items?.length ? undefined : 'Channel not accessible' }; } catch (e: any) { return { ok: false, reason: e.message }; } },
  async afterConnect(_creds, channel) {
    await http('https://pubsubhubbub.appspot.com/subscribe', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ 'hub.callback': `${env.API_URL}/webhooks/youtube`, 'hub.mode': 'subscribe', 'hub.topic': `https://www.youtube.com/feeds/videos.xml?channel_id=${channel.externalId}`, 'hub.verify': 'async', 'hub.lease_seconds': '864000', 'hub.secret': env.YT_HUB_SECRET }) }).catch(e => log.warn({ e: e.message }, 'yt pubsubhubbub subscribe failed'));
  },
  publishBudget() { return [{ key: 'yt:project:uploads', limit: 100, windowSec: 86400 }]; },

  async publish({ target, creds }) {
    const md = (target.metadata ?? {}) as any, m = ((target.media as unknown as MediaRef[]) ?? [])[0];
    if (!m || m.kind !== 'video') throw new ConnectorError('VALIDATION', 'YouTube requires a video', { retryable: false });
    const src = await streamFromS3(m, 'yt_video');
    const scheduled = !!md.publishAt;
    const meta = {
      snippet: { title: String(md.title ?? firstLine(target.text) ?? 'Untitled').slice(0, 100).replace(/[<>]/g, ''), description: target.text.slice(0, 5000), tags: md.tags?.slice(0, 30), categoryId: md.categoryId ?? '22', defaultLanguage: md.language },
      status: { privacyStatus: scheduled ? 'private' : (md.privacyStatus ?? 'public'), publishAt: md.publishAt, selfDeclaredMadeForKids: !!md.madeForKids, embeddable: true, publicStatsViewable: true, containsSyntheticMedia: !!md.aiGenerated },
    };
    const init = await http(`https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status&notifySubscribers=${md.notifySubscribers !== false}`, { method: 'POST', headers: { Authorization: `Bearer ${creds.accessToken}`, 'content-type': 'application/json; charset=UTF-8', 'X-Upload-Content-Length': String(src.size), 'X-Upload-Content-Type': src.mime }, body: JSON.stringify(meta) });
    if (!init.ok) throw await gErr(init);
    const session = init.headers.get('location')!;
    let offset = 0; let video: any;
    for await (const chunk of chunkStream(src.stream, 8 * 1024 * 1024)) {
      const end = offset + chunk.length - 1;
      const r = await http(session, { method: 'PUT', headers: { 'content-length': String(chunk.length), 'content-type': src.mime, 'content-range': `bytes ${offset}-${end}/${src.size}` }, body: chunk, timeoutMs: 10 * 60_000 });
      if (r.status === 308) { offset = end + 1; continue; }
      if (r.status >= 500) throw new ConnectorError('PLATFORM', 'YouTube upload interrupted', { retryable: true });
      if (!r.ok) throw await gErr(r);
      video = await readJson(r);
    }
    if (!video?.id) throw new ConnectorError('PLATFORM', 'YouTube upload did not return a video', { retryable: true });
    if (['rejected', 'failed'].includes(video.status?.uploadStatus)) throw new ConnectorError('MEDIA', `YouTube ${video.status.uploadStatus}: ${video.status.rejectionReason ?? video.status.failureReason ?? ''}`, { retryable: false, raw: video });
    if (m.cover?.assetId) {
      const thumb = await streamFromS3({ assetId: m.cover.assetId, kind: 'image' }, 'yt_thumb');
      await http(`https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=${video.id}`, { method: 'POST', headers: { Authorization: `Bearer ${creds.accessToken}`, 'content-type': thumb.mime }, body: await thumb.bytes }).catch(() => undefined);
    }
    if (md.playlistId) await gpost(`${YT}/playlistItems?part=snippet`, creds.accessToken, { snippet: { playlistId: md.playlistId, resourceId: { kind: 'youtube#video', videoId: video.id } } }).catch(() => undefined);
    return { externalId: video.id, url: `https://youtube.com/shorts/${video.id}` };
  },
  async deletePost(creds, _ch, id) { await gdel(`${YT}/videos?id=${id}`, creds.accessToken); },

  async collectPostMetrics({ creds, externalPostIds }) {
    const out: { externalPostId: string; metric: string; value: number }[] = [];
    for (const chunk of chunks(externalPostIds, 50)) {
      const r = await gget(`${YT}/videos`, creds.accessToken, { part: 'statistics', id: chunk.join(',') }).catch(() => ({ items: [] }));
      for (const v of r.items ?? []) out.push({ externalPostId: v.id, metric: 'video_views', value: Number(v.statistics?.viewCount ?? 0) }, { externalPostId: v.id, metric: 'likes', value: Number(v.statistics?.likeCount ?? 0) }, { externalPostId: v.id, metric: 'comments', value: Number(v.statistics?.commentCount ?? 0) });
    }
    return out;
  },
  async collectChannelMetrics({ creds, since, until }) {
    const rows: { day: string; metric: string; value: number }[] = [];
    const r = await gget(YTA, creds.accessToken, { ids: 'channel==MINE', startDate: since.toISOString().slice(0, 10), endDate: until.toISOString().slice(0, 10), metrics: Object.keys(AMAP).join(','), dimensions: 'day', sort: 'day' }).catch(() => ({ rows: [], columnHeaders: [] }));
    const cols = (r.columnHeaders ?? []).map((c: any) => c.name);
    for (const row of r.rows ?? []) for (let i = 1; i < row.length; i++) rows.push({ day: row[0], metric: AMAP[cols[i]] ?? cols[i], value: Number(row[i]) });
    const ch = await gget(`${YT}/channels`, creds.accessToken, { part: 'statistics', mine: 'true' }).catch(() => ({}));
    rows.push({ day: until.toISOString().slice(0, 10), metric: 'followers', value: Number(ch.items?.[0]?.statistics?.subscriberCount ?? 0) });
    return rows;
  },
  async collectAudience({ creds, since, until }) {
    const out: { dimension: string; bucket: string; value: number }[] = [];
    const r = await gget(YTA, creds.accessToken, { ids: 'channel==MINE', startDate: since.toISOString().slice(0, 10), endDate: until.toISOString().slice(0, 10), metrics: 'viewerPercentage', dimensions: 'ageGroup,gender' }).catch(() => ({ rows: [] }));
    for (const [age, gender, pct] of r.rows ?? []) out.push({ dimension: 'age', bucket: String(age).replace('age', ''), value: Number(pct) }, { dimension: 'gender', bucket: String(gender), value: Number(pct) });
    return out;
  },
  async listRecentPosts(creds, channel, since) {
    const pl = (channel.meta as any)?.uploadsPlaylist; if (!pl) return [];
    const r = await gget(`${YT}/playlistItems`, creds.accessToken, { part: 'snippet,contentDetails', playlistId: pl, maxResults: '50' }).catch(() => ({ items: [] }));
    return (r.items ?? []).filter((i: any) => Date.parse(i.contentDetails?.videoPublishedAt ?? i.snippet.publishedAt) >= since.getTime()).map((i: any) => ({ externalId: i.contentDetails.videoId, text: i.snippet.title, url: `https://youtube.com/watch?v=${i.contentDetails.videoId}`, createdAt: new Date(i.contentDetails?.videoPublishedAt ?? i.snippet.publishedAt), mediaUrl: i.snippet.thumbnails?.medium?.url }));
  },

  async pollInbox(creds, channel, cursor) {
    const r = await gget(`${YT}/commentThreads`, creds.accessToken, { part: 'snippet,replies', allThreadsRelatedToChannelId: channel.externalId, order: 'time', maxResults: '100', textFormat: 'plainText' }).catch(() => ({ items: [] }));
    const since = cursor ? Date.parse(cursor) : 0; const items: InboxItem[] = [];
    for (const t of r.items ?? []) {
      const s = t.snippet.topLevelComment.snippet;
      if (Date.parse(s.updatedAt) <= since) continue;
      items.push({ externalId: t.snippet.topLevelComment.id, externalPostId: t.snippet.videoId, kind: 'COMMENT', author: { id: s.authorChannelId?.value, name: s.authorDisplayName, avatarUrl: s.authorProfileImageUrl }, text: s.textOriginal, createdAt: new Date(s.publishedAt), likeCount: s.likeCount, isOurs: s.authorChannelId?.value === channel.externalId, raw: t });
      for (const rep of t.replies?.comments ?? []) items.push({ externalId: rep.id, parentExternalId: t.snippet.topLevelComment.id, externalPostId: t.snippet.videoId, kind: 'REPLY', author: { id: rep.snippet.authorChannelId?.value, name: rep.snippet.authorDisplayName, avatarUrl: rep.snippet.authorProfileImageUrl }, text: rep.snippet.textOriginal, createdAt: new Date(rep.snippet.publishedAt), isOurs: rep.snippet.authorChannelId?.value === channel.externalId, raw: rep });
    }
    return { items, cursor: new Date().toISOString() };
  },
  async reply(creds, _ch, item, text) { const r = await gpost(`${YT}/comments?part=snippet`, creds.accessToken, { snippet: { parentId: item.parentExternalId ?? item.externalId, textOriginal: text } }); return { externalId: r.id }; },
  async hide(creds, _ch, item, hidden) { await gpost(`${YT}/comments/setModerationStatus?id=${item.externalId}&moderationStatus=${hidden ? 'rejected' : 'published'}`, creds.accessToken, {}); },
  async deleteComment(creds, _ch, item) { await gdel(`${YT}/comments?id=${item.externalId}`, creds.accessToken); },

  verifyWebhook(req) {
    if (req.query['hub.challenge']) return { ok: true, challengeResponse: req.query['hub.challenge'], contentType: 'text/plain' };
    return { ok: safeEqual(req.headers['x-hub-signature'] ?? '', 'sha1=' + hmacSha1(env.YT_HUB_SECRET, req.rawBody)) };
  },
  parseWebhook(body) {
    // Atom XML is parsed by ingest into { channelId, videoId }
    if (body?.channelId && body?.videoId) return [{ externalChannelId: body.channelId, kind: 'media', raw: body }];
    return [];
  },
};
const hmacSha1 = (secret: string, data: Buffer) => createHmac('sha1', secret).update(data).digest('hex');
