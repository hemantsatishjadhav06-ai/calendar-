import { devtoRules } from '@cadence/network-rules';
import type { SocialConnector, MediaRef } from '../types.js';
import { ConnectorError, http, readJson, newState, mediaUrl } from '../shared/index.js';

/**
 * DEV.to (Forem) connector — long-form Markdown articles.
 *
 * Unlike every other network here, DEV.to authenticates with a per-user API key (Forem has no
 * OAuth app-install flow for the write API), so there is no product-level app credential. The user
 * pastes their key on the connect screen; it arrives as the `hint`. To reuse the standard
 * connect machinery we validate the key in authStart and hand the browser straight back to the
 * OAuth callback (no third-party redirect), where authCallback turns it into a single channel.
 *
 * Forem REST API: https://developers.forem.com/api  (base https://dev.to/api, header `api-key`).
 */
const API = 'https://dev.to/api';

const authHeaders = (apiKey: string) => ({ 'api-key': apiKey, accept: 'application/vnd.forem.api-v1+json' });

/**
 * Build the Forem `article` payload from a target's text + metadata. Pure and side-effect free
 * (the cover image URL is resolved by the caller and passed in) so it can be unit-tested.
 * Forem caps tags at 4; anything beyond is dropped.
 */
export function buildArticle(title: string, text: string, md: Record<string, any>, mainImage?: string): Record<string, any> {
  return {
    title,
    body_markdown: text ?? '',
    published: md.published !== false,
    ...(Array.isArray(md.tags) && md.tags.length ? { tags: md.tags.slice(0, 4) } : {}),
    ...(mainImage ? { main_image: mainImage } : {}),
    ...(md.series ? { series: md.series } : {}),
    ...(md.canonicalUrl ? { canonical_url: md.canonicalUrl } : {}),
  };
}

async function fetchMe(apiKey: string) {
  const res = await http(`${API}/users/me`, { method: 'GET', headers: authHeaders(apiKey) });
  return readJson<{ id: number; username: string; name?: string; profile_image?: string }>(res);
}

export const devto: SocialConnector = {
  network: 'DEVTO',
  rules: devtoRules,

  async authStart({ hint, redirectUri }) {
    const apiKey = (hint ?? '').trim();
    if (!apiKey) throw new ConnectorError('VALIDATION', 'Paste your DEV.to API key to connect', { retryable: false });
    let me: Awaited<ReturnType<typeof fetchMe>>;
    try {
      me = await fetchMe(apiKey);
    } catch {
      throw new ConnectorError('VALIDATION', 'That DEV.to API key was rejected. Create one at dev.to → Settings → Extensions → API Keys.', { retryable: false });
    }
    if (!me?.id) throw new ConnectorError('VALIDATION', 'Could not read your DEV.to account from that API key', { retryable: false });
    const state = newState();
    // Send the browser straight to our own OAuth callback; the key + account ride along in state.
    return { url: `${redirectUri}?state=${state}`, state, extra: { apiKey, user: me } };
  },

  async authCallback({ extra }) {
    const apiKey: string | undefined = extra?.apiKey;
    const user = extra?.user;
    if (!apiKey || !user?.id) throw new ConnectorError('AUTH', 'DEV.to connection expired, please try again', { retryable: false });
    return {
      creds: { accessToken: apiKey, tokenType: 'apikey', extra: {} },
      candidates: [{ externalId: String(user.id), subtype: 'user', displayName: user.name || user.username, handle: `@${user.username}`, avatarUrl: user.profile_image, meta: { username: user.username } }],
    };
  },

  async refresh(creds) { return creds; }, // API keys do not expire

  async health(creds) {
    try { await fetchMe(creds.accessToken); return { ok: true }; }
    catch (e: any) { return { ok: false, reason: e?.message ?? 'API key rejected' }; }
  },

  publishBudget(target) {
    // Forem allows a burst of ~10 article writes per 30s per user.
    return [{ key: `devto:${target.channelId}:articles`, limit: 10, windowSec: 30 }];
  },

  async publish({ target, creds }) {
    const md = (target.metadata ?? {}) as any;
    const media = ((target.media as unknown as MediaRef[]) ?? []);
    const title: string | undefined = (md.title ?? '').trim() || undefined;
    if (!title) throw new ConnectorError('VALIDATION', 'DEV.to articles need a title', { retryable: false });

    let mainImage: string | undefined = md.coverImageUrl;
    const cover = media.find(m => m.kind === 'image' || m.kind === 'gif');
    if (!mainImage && cover) {
      try { mainImage = await mediaUrl(cover, 'devto_cover', { ttlSec: 60 * 60 * 24 * 30 }); } catch { mainImage = undefined; }
    }

    const article = buildArticle(title, target.text ?? '', md, mainImage);

    const res = await http(`${API}/articles`, { method: 'POST', headers: { ...authHeaders(creds.accessToken), 'content-type': 'application/json' }, body: JSON.stringify({ article }) });
    const j = await readJson<{ id: number; url: string }>(res);
    if (!j?.id) throw new ConnectorError('PLATFORM', 'DEV.to did not return an article id', { retryable: true, raw: j });
    return { externalId: String(j.id), url: j.url };
  },

  async deletePost(creds, _channel, externalId) {
    // Forem has no article delete endpoint; unpublish instead (idempotent, best-effort).
    await http(`${API}/articles/${externalId}`, { method: 'PUT', headers: { ...authHeaders(creds.accessToken), 'content-type': 'application/json' }, body: JSON.stringify({ article: { published: false } }) }).catch(() => undefined);
  },
};
