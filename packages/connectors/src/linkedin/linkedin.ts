import { env } from '@relay/config';
import { linkedinRules } from '@relay/network-rules';
import type { SocialConnector, MediaRef, InboxItem } from '../types.js';
import { ConnectorError, http, readJson, newState, assertConfigured, streamFromS3, chunkStream, sleep, chunks, msUntilUtcMidnight, hmacHex, safeEqual } from '../shared/index.js';

const LI = 'https://api.linkedin.com/rest';
const SCOPES = ['openid', 'profile', 'email', 'w_member_social', 'r_organization_social', 'w_organization_social', 'rw_organization_admin'];
const enc = (urn: string) => encodeURIComponent(urn);
const isOrg = (urn: string) => urn.startsWith('urn:li:organization:');

export const linkedin: SocialConnector = {
  network: 'LINKEDIN',
  rules: linkedinRules,

  async authStart({ redirectUri }) {
    assertConfigured(['LI_CLIENT_ID', env.LI_CLIENT_ID]);
    const state = newState();
    return { url: 'https://www.linkedin.com/oauth/v2/authorization?' + new URLSearchParams({ response_type: 'code', client_id: env.LI_CLIENT_ID!, redirect_uri: redirectUri, state, scope: SCOPES.join(' ') }), state };
  },
  async authCallback({ code, redirectUri }) {
    const tok = await token({ grant_type: 'authorization_code', code, redirect_uri: redirectUri });
    const me: any = await readJson(await http('https://api.linkedin.com/v2/userinfo', { headers: { Authorization: `Bearer ${tok.access_token}` } }));
    const personUrn = `urn:li:person:${me.sub}`;
    const candidates: any[] = [{ externalId: personUrn, subtype: 'profile', displayName: me.name, avatarUrl: me.picture }];
    const acls = await lget('/organizationAcls', tok.access_token, { q: 'roleAssignee', role: 'ADMINISTRATOR', state: 'APPROVED', projection: '(elements*(organization~(id,localizedName,vanityName,logoV2(original~:playableStreams))))' }).catch(() => ({ elements: [] }));
    for (const e of acls.elements ?? []) {
      const o = e['organization~']; if (!o) continue;
      candidates.push({ externalId: `urn:li:organization:${o.id}`, subtype: 'page', displayName: o.localizedName, handle: o.vanityName, avatarUrl: o.logoV2?.['original~']?.elements?.[0]?.identifiers?.[0]?.identifier });
    }
    return { creds: { accessToken: tok.access_token, refreshToken: tok.refresh_token, tokenType: 'bearer', accessExpiresAt: new Date(Date.now() + tok.expires_in * 1000), refreshExpiresAt: tok.refresh_token_expires_in ? new Date(Date.now() + tok.refresh_token_expires_in * 1000) : undefined, scopes: String(tok.scope ?? '').split(/[ ,]/).filter(Boolean), extra: { personUrn } }, candidates };
  },
  async refresh(creds) {
    if (!creds.refreshToken) throw new ConnectorError('AUTH', 'LinkedIn token expired — please reconnect', { retryable: false });
    const tok = await token({ grant_type: 'refresh_token', refresh_token: creds.refreshToken });
    return { ...creds, accessToken: tok.access_token, refreshToken: tok.refresh_token ?? creds.refreshToken, accessExpiresAt: new Date(Date.now() + tok.expires_in * 1000) };
  },
  async health(creds) {
    const r: any = await readJson(await http('https://www.linkedin.com/oauth/v2/introspectToken', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: creds.accessToken, client_id: env.LI_CLIENT_ID!, client_secret: env.LI_CLIENT_SECRET! }) }));
    return r.active ? { ok: true, scopes: String(r.scope ?? '').split(',') } : { ok: false, reason: `Token ${r.status ?? 'inactive'}` };
  },
  publishBudget(target) { return [{ key: `li:${target.channelId}:posts`, limit: 150, windowSec: 86400 }]; },

  async publish({ target, channel, creds }) {
    const author = channel.externalId, tok = creds.accessToken, md = (target.metadata ?? {}) as any, media = (target.media as unknown as MediaRef[]) ?? [];
    const body: any = { author, commentary: littleText(target.text, md.mentions), visibility: md.visibility ?? 'PUBLIC', distribution: { feedDistribution: 'MAIN_FEED', targetEntities: md.targetEntities ?? [], thirdPartyDistributionChannels: [] }, lifecycleState: 'PUBLISHED', isReshareDisabledByAuthor: !!md.disableReshare };

    if (md.poll) body.content = { poll: { question: md.poll.question, options: md.poll.options.map((t: string) => ({ text: t })), settings: { duration: md.poll.duration ?? 'SEVEN_DAYS' } } };
    else if (media[0]?.kind === 'document') { const urn = await simpleUpload(tok, author, 'documents', media[0], 'li_document'); body.content = { media: { id: urn, title: md.document?.title ?? md.title ?? 'Document' } }; }
    else if (media.length === 1 && media[0].kind === 'video') { const urn = await uploadVideo(tok, author, media[0]); body.content = { media: { id: urn, title: md.title ?? 'Video' } }; }
    else if (media.length === 1) { const urn = await simpleUpload(tok, author, 'images', media[0], 'li_image'); body.content = { media: { id: urn, altText: media[0].altText } }; }
    else if (media.length > 1) { const images: any[] = []; for (const m of media.slice(0, 20)) images.push({ id: await simpleUpload(tok, author, 'images', m, 'li_image'), altText: m.altText }); body.content = { multiImage: { images } }; }
    else if (target.linkPreviewUrl) {
      const lp = (((target as any).post)?.linkPreview ?? {}) as any;
      body.content = { article: { source: target.linkPreviewUrl, title: (lp.title ?? target.linkPreviewUrl).slice(0, 400), description: (lp.description ?? '').slice(0, 4086), ...(lp.imageAssetId ? { thumbnail: await simpleUpload(tok, author, 'images', { assetId: lp.imageAssetId, kind: 'image' }, 'li_link_thumb') } : {}) } };
    }

    const res = await http(`${LI}/posts`, { method: 'POST', headers: headers(tok), body: JSON.stringify(body) });
    if (!res.ok) throw await liError(res);
    const postUrn = res.headers.get('x-restli-id')!;
    if (target.firstComment) await http(`${LI}/socialActions/${enc(postUrn)}/comments`, { method: 'POST', headers: headers(tok), body: JSON.stringify({ actor: author, object: postUrn, message: { text: target.firstComment } }) }).catch(() => undefined);
    return { externalId: postUrn, url: `https://www.linkedin.com/feed/update/${postUrn}` };
  },
  async deletePost(creds, _ch, urn) { const r = await http(`${LI}/posts/${enc(urn)}`, { method: 'DELETE', headers: headers(creds.accessToken) }); if (!r.ok && r.status !== 404) throw await liError(r); },

  async collectChannelMetrics({ channel, creds, since, until }) {
    if (!isOrg(channel.externalId)) return [];
    const org = channel.externalId, tok = creds.accessToken, rows: { day: string; metric: string; value: number }[] = [];
    const ti = `(timeRange:(start:${since.getTime()},end:${until.getTime()}),timeGranularityType:DAY)`;
    const f = await lget('/organizationalEntityFollowerStatistics', tok, { q: 'organizationalEntity', organizationalEntity: org, timeIntervals: ti }).catch(() => ({ elements: [] }));
    for (const e of f.elements ?? []) rows.push({ day: dayOf(e.timeRange.start), metric: 'follows', value: (e.followerGains?.organicFollowerGain ?? 0) + (e.followerGains?.paidFollowerGain ?? 0) });
    const s = await lget('/organizationalEntityShareStatistics', tok, { q: 'organizationalEntity', organizationalEntity: org, timeIntervals: ti }).catch(() => ({ elements: [] }));
    for (const e of s.elements ?? []) { const d = dayOf(e.timeRange.start), t = e.totalShareStatistics ?? {}; rows.push({ day: d, metric: 'impressions', value: t.impressionCount ?? 0 }, { day: d, metric: 'clicks', value: t.clickCount ?? 0 }, { day: d, metric: 'likes', value: t.likeCount ?? 0 }, { day: d, metric: 'comments', value: t.commentCount ?? 0 }, { day: d, metric: 'shares', value: t.shareCount ?? 0 }, { day: d, metric: 'engagement_rate', value: t.engagement ?? 0 }); }
    const n = await lget(`/networkSizes/${enc(org)}`, tok, { edgeType: 'CompanyFollowedByMember' }).catch(() => null);
    if (n?.firstDegreeSize != null) rows.push({ day: until.toISOString().slice(0, 10), metric: 'followers', value: n.firstDegreeSize });
    const p = await lget('/organizationPageStatistics', tok, { q: 'organization', organization: org, timeIntervals: ti }).catch(() => ({ elements: [] }));
    for (const e of p.elements ?? []) rows.push({ day: dayOf(e.timeRange.start), metric: 'profile_views', value: e.totalPageStatistics?.views?.allPageViews?.pageViews ?? 0 });
    return rows;
  },
  async collectPostMetrics({ channel, creds, externalPostIds }) {
    const out: { externalPostId: string; metric: string; value: number }[] = [];
    if (!isOrg(channel.externalId)) {
      for (const urn of externalPostIds) { const m = await lget(`/socialMetadata/${enc(urn)}`, creds.accessToken, {}).catch(() => null); if (!m) continue; out.push({ externalPostId: urn, metric: 'likes', value: Object.values(m.reactionSummaries ?? {}).reduce((a: number, r: any) => a + (r.count ?? 0), 0) }, { externalPostId: urn, metric: 'comments', value: m.commentSummary?.count ?? 0 }); }
      return out;
    }
    for (const chunk of chunks(externalPostIds, 20)) {
      const groups: [string, string[]][] = [['shares', chunk.filter(u => u.includes(':share:'))], ['ugcPosts', chunk.filter(u => u.includes(':ugcPost:'))]];
      for (const [k, list] of groups) {
        if (!list.length) continue;
        const r = await lget('/organizationalEntityShareStatistics', creds.accessToken, { q: 'organizationalEntity', organizationalEntity: channel.externalId, [k]: `List(${list.map(enc).join(',')})` }).catch(() => ({ elements: [] }));
        for (const e of r.elements ?? []) { const id = e.share ?? e.ugcPost, t = e.totalShareStatistics ?? {}; out.push({ externalPostId: id, metric: 'impressions', value: t.impressionCount ?? 0 }, { externalPostId: id, metric: 'reach', value: t.uniqueImpressionsCount ?? 0 }, { externalPostId: id, metric: 'clicks', value: t.clickCount ?? 0 }, { externalPostId: id, metric: 'likes', value: t.likeCount ?? 0 }, { externalPostId: id, metric: 'comments', value: t.commentCount ?? 0 }, { externalPostId: id, metric: 'shares', value: t.shareCount ?? 0 }, { externalPostId: id, metric: 'engagement_rate', value: t.engagement ?? 0 }); }
      }
    }
    return out;
  },
  async listRecentPosts(creds, channel) {
    if (!isOrg(channel.externalId)) return [];
    const r = await lget('/posts', creds.accessToken, { q: 'author', author: channel.externalId, count: '20', sortBy: 'LAST_MODIFIED' }).catch(() => ({ elements: [] }));
    return (r.elements ?? []).map((p: any) => ({ externalId: p.id, text: p.commentary, url: `https://www.linkedin.com/feed/update/${p.id}`, createdAt: new Date(p.createdAt ?? Date.now()) }));
  },
  async pollInbox(creds, channel, cursor) {
    if (!isOrg(channel.externalId)) return { items: [], cursor };
    const since = cursor ? Number(cursor) : Date.now() - 7 * 864e5; const items: InboxItem[] = [];
    const posts = await lget('/posts', creds.accessToken, { q: 'author', author: channel.externalId, count: '20', sortBy: 'LAST_MODIFIED' }).catch(() => ({ elements: [] }));
    for (const p of posts.elements ?? []) {
      const c = await lget(`/socialActions/${enc(p.id)}/comments`, creds.accessToken, { count: '50', projection: '(elements*(*,actor~(localizedFirstName,localizedLastName,vanityName,profilePicture(displayImage~:playableStreams))))' }).catch(() => ({ elements: [] }));
      for (const xc of c.elements ?? []) {
        if ((xc.created?.time ?? 0) < since) continue;
        const a = xc['actor~'];
        items.push({ externalId: xc.commentUrn ?? xc.$URN ?? xc.id, parentExternalId: xc.parentComment, externalPostId: p.id, kind: xc.parentComment ? 'REPLY' : 'COMMENT', author: { id: xc.actor, name: a ? `${a.localizedFirstName ?? ''} ${a.localizedLastName ?? ''}`.trim() : undefined, handle: a?.vanityName }, text: xc.message?.text ?? '', createdAt: new Date(xc.created?.time ?? Date.now()), likeCount: xc.likesSummary?.totalLikes, isOurs: xc.actor === channel.externalId, raw: xc });
      }
    }
    return { items, cursor: String(Date.now()) };
  },
  async reply(creds, ch, item, text) {
    const r = await http(`${LI}/socialActions/${enc(item.externalPostId!)}/comments`, { method: 'POST', headers: headers(creds.accessToken), body: JSON.stringify({ actor: ch.externalId, object: item.externalPostId, message: { text }, parentComment: item.externalId }) });
    if (!r.ok) throw await liError(r);
    return { externalId: r.headers.get('x-restli-id') ?? '' };
  },
  async like(creds, ch, item, reaction = 'LIKE') {
    const r = await http(`${LI}/reactions?actor=${enc(ch.externalId)}`, { method: 'POST', headers: headers(creds.accessToken), body: JSON.stringify({ root: item.externalId, reactionType: reaction }) });
    if (!r.ok && r.status !== 409) throw await liError(r);
  },
  async deleteComment(creds, ch, item) {
    const cid = item.externalId.split(',').pop()!.replace(')', '');
    const r = await http(`${LI}/socialActions/${enc(item.externalPostId!)}/comments/${cid}?actor=${enc(ch.externalId)}`, { method: 'DELETE', headers: headers(creds.accessToken) });
    if (!r.ok && r.status !== 404) throw await liError(r);
  },
  verifyWebhook(req) {
    if (req.query.challengeCode) return { ok: true, challengeResponse: JSON.stringify({ challengeCode: req.query.challengeCode, challengeResponse: hmacHex(env.LI_CLIENT_SECRET ?? '', req.query.challengeCode) }), contentType: 'application/json' };
    return { ok: safeEqual(req.headers['x-li-signature'] ?? '', 'hmacsha256=' + hmacHex(env.LI_CLIENT_SECRET ?? '', req.rawBody)) };
  },
  parseWebhook(body) {
    if (body.eventType !== 'ORGANIZATION_SOCIAL_ACTION_NOTIFICATIONS') return [];
    const p = body.payload ?? {};
    const isInbox = ['COMMENT', 'COMMENT_MENTION', 'SHARE_MENTION'].includes(p.action);
    return [{ externalChannelId: p.organizationalEntity, kind: 'inbox', raw: body, items: isInbox ? [{ externalId: p.object, externalPostId: p.generatedActivity, kind: p.action === 'COMMENT' ? 'COMMENT' : 'MENTION', author: { id: p.actor }, text: '', createdAt: new Date(body.createdAt ?? Date.now()), raw: { ...p, needsEnrichment: true } }] : [] }];
  },
  async lookup(creds, _ch, what, args) {
    if (what === 'organizations') { const r = await lget('/organizations', creds.accessToken, { q: 'vanityName', vanityName: args?.vanityName ?? '' }).catch(() => ({ elements: [] })); return (r.elements ?? []).map((o: any) => ({ urn: `urn:li:organization:${o.id}`, name: o.localizedName, vanity: o.vanityName })); }
    return null;
  },
};

// ---- helpers
const headers = (tok: string) => ({ Authorization: `Bearer ${tok}`, 'Linkedin-Version': env.LI_VERSION, 'X-Restli-Protocol-Version': '2.0.0', 'content-type': 'application/json' });
const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);
async function lget(path: string, tok: string, params: Record<string, string>) {
  // Rest.li 2.0 wants URNs, List(...) and (key:value) unescaped in the query string
  const qs = Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v).replace(/%2C/g, ',').replace(/%3A/g, ':').replace(/%28/g, '(').replace(/%29/g, ')')}`).join('&');
  const r = await http(`${LI}${path}${qs ? `?${qs}` : ''}`, { headers: headers(tok) });
  if (!r.ok) throw await liError(r);
  return readJson(r);
}
async function token(form: Record<string, string>) {
  const r = await http('https://www.linkedin.com/oauth/v2/accessToken', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ ...form, client_id: env.LI_CLIENT_ID!, client_secret: env.LI_CLIENT_SECRET! }) });
  const j: any = await readJson(r);
  if (!r.ok) throw new ConnectorError('AUTH', j.error_description ?? j.error ?? 'LinkedIn token error', { retryable: false, raw: j });
  return j;
}
async function liError(res: Response) {
  const j: any = await readJson(res);
  if (res.status === 401) return new ConnectorError('AUTH', j.message ?? 'Unauthorized', { retryable: false, raw: j });
  if (res.status === 429) return new ConnectorError('RATE_LIMIT', 'LinkedIn daily quota reached', { retryable: true, retryAfterMs: msUntilUtcMidnight(), raw: j });
  if (res.status === 426) return new ConnectorError('PLATFORM', `Linkedin-Version ${env.LI_VERSION} has been sunset — bump LI_VERSION`, { retryable: false, raw: j });
  if (res.status === 422 && j.code === 'DUPLICATE_POST') return new ConnectorError('VALIDATION', 'LinkedIn rejected a duplicate post', { retryable: false, raw: j });
  if (res.status === 403) return new ConnectorError('POLICY', j.message ?? 'LinkedIn access denied (missing product/tier)', { retryable: false, raw: j });
  return new ConnectorError(res.status >= 500 ? 'PLATFORM' : 'VALIDATION', j.message ?? res.statusText, { retryable: res.status >= 500, raw: j });
}
async function simpleUpload(tok: string, owner: string, kind: 'images' | 'documents', m: MediaRef, rendition: string) {
  const initRes = await http(`${LI}/${kind}?action=initializeUpload`, { method: 'POST', headers: headers(tok), body: JSON.stringify({ initializeUploadRequest: { owner } }) });
  if (!initRes.ok) throw await liError(initRes);
  const init: any = await readJson(initRes);
  const src = await streamFromS3(m, rendition);
  const put = await http(init.value.uploadUrl, { method: 'PUT', headers: { Authorization: `Bearer ${tok}`, 'content-type': 'application/octet-stream' }, body: await src.bytes });
  if (!put.ok) throw new ConnectorError('MEDIA', `LinkedIn upload failed (${put.status})`, { retryable: put.status >= 500 });
  const urn = init.value.image ?? init.value.document;
  await waitAvailable(tok, kind, urn);
  return urn;
}
async function uploadVideo(tok: string, owner: string, m: MediaRef) {
  const src = await streamFromS3(m, 'li_video');
  const initRes = await http(`${LI}/videos?action=initializeUpload`, { method: 'POST', headers: headers(tok), body: JSON.stringify({ initializeUploadRequest: { owner, fileSizeBytes: src.size, uploadCaptions: false, uploadThumbnail: false } }) });
  if (!initRes.ok) throw await liError(initRes);
  const init: any = await readJson(initRes);
  const etags: string[] = []; let i = 0;
  for await (const part of chunkStream(src.stream, 4 * 1024 * 1024)) {
    const ins = init.value.uploadInstructions[i++];
    const r = await http(ins.uploadUrl, { method: 'PUT', headers: { Authorization: `Bearer ${tok}`, 'content-type': 'application/octet-stream' }, body: part });
    if (!r.ok) throw new ConnectorError('MEDIA', 'LinkedIn video part upload failed', { retryable: true });
    etags.push(r.headers.get('etag') ?? '');
  }
  const fin = await http(`${LI}/videos?action=finalizeUpload`, { method: 'POST', headers: headers(tok), body: JSON.stringify({ finalizeUploadRequest: { video: init.value.video, uploadToken: init.value.uploadToken ?? '', uploadedPartIds: etags } }) });
  if (!fin.ok) throw await liError(fin);
  await waitAvailable(tok, 'videos', init.value.video, 15 * 60_000);
  return init.value.video;
}
async function waitAvailable(tok: string, kind: string, urn: string, timeout = 5 * 60_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const s = await lget(`/${kind}/${enc(urn)}`, tok, {});
    if (s.status === 'AVAILABLE') return;
    if (s.status === 'PROCESSING_FAILED') throw new ConnectorError('MEDIA', `LinkedIn could not process the ${kind.slice(0, -1)}${s.processingFailureReason ? `: ${s.processingFailureReason}` : ''}`, { retryable: false });
    await sleep(3000);
  }
  throw new ConnectorError('PLATFORM', 'LinkedIn media processing timed out', { retryable: true });
}
/** LinkedIn "little text": escape reserved chars, inject @[Name](urn) mentions, keep #hashtags. */
export function littleText(text: string, mentions: { display: string; urn: string }[] = []) {
  const esc = (s: string) => s.replace(/[()\[\]{}<>@|~_*#\\]/g, c => '\\' + c);
  let out = esc(text);
  for (const m of mentions) out = out.split(esc('@' + m.display)).join(`@[${m.display}](${m.urn})`);
  return out.replace(/\\#(\p{L}|\p{N})/gu, '#$1');
}
