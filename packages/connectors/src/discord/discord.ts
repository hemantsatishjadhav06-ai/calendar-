import { discordRules } from '@cadence/network-rules';
import type { SocialConnector, MediaRef } from '../types.js';
import { ConnectorError, http, readJson, newState, streamFromS3 } from '../shared/index.js';

/**
 * Discord connector — publishes to a channel through an Incoming Webhook.
 *
 * Discord has no per-user OAuth posting flow that a scheduler can reuse; the standard integration is
 * an Incoming Webhook URL that a server admin creates (Server Settings → Integrations → Webhooks).
 * So, like DEV.to, there is no product-level app credential: the user pastes their webhook URL on the
 * connect screen (it arrives as the `hint`). We validate it in authStart and hand the browser straight
 * back to our own OAuth callback, where authCallback turns it into one channel.
 *
 * Webhook API: https://discord.com/developers/docs/resources/webhook
 */
const MAX_CONTENT = 2000;
const MAX_FILES = 10;

interface Hook { id: string; name?: string; channel_id?: string; guild_id?: string; avatar?: string | null }

/** A webhook URL looks like https://discord.com/api/webhooks/{id}/{token} (canary/ptb subdomains too). */
export function isWebhookUrl(url: string): boolean {
  return /^https:\/\/(?:canary\.|ptb\.)?discord(?:app)?\.com\/api(?:\/v\d+)?\/webhooks\/\d+\/[\w-]+/.test(url.trim());
}

async function fetchHook(webhookUrl: string): Promise<Hook> {
  const res = await http(webhookUrl, { method: 'GET' });
  return readJson<Hook>(res);
}

/** Build the public message permalink when the webhook exposed its guild/channel. */
export function messageUrl(hook: Hook, messageId: string): string | undefined {
  return hook.guild_id && hook.channel_id ? `https://discord.com/channels/${hook.guild_id}/${hook.channel_id}/${messageId}` : undefined;
}

export const discord: SocialConnector = {
  network: 'DISCORD',
  rules: discordRules,

  async authStart({ hint, redirectUri }) {
    const webhookUrl = (hint ?? '').trim();
    if (!webhookUrl) throw new ConnectorError('VALIDATION', 'Paste your Discord webhook URL to connect', { retryable: false });
    if (!isWebhookUrl(webhookUrl)) throw new ConnectorError('VALIDATION', "That doesn't look like a Discord webhook URL. It should start with https://discord.com/api/webhooks/…", { retryable: false });
    let hook: Hook;
    try {
      hook = await fetchHook(webhookUrl);
    } catch {
      throw new ConnectorError('VALIDATION', 'Discord rejected that webhook URL. Recreate it in Server Settings → Integrations → Webhooks and copy the full URL.', { retryable: false });
    }
    if (!hook?.id) throw new ConnectorError('VALIDATION', 'Could not read that Discord webhook', { retryable: false });
    const state = newState();
    return { url: `${redirectUri}?state=${state}`, state, extra: { webhookUrl, hook } };
  },

  async authCallback({ extra }) {
    const webhookUrl: string | undefined = extra?.webhookUrl;
    const hook: Hook | undefined = extra?.hook;
    if (!webhookUrl || !hook?.id) throw new ConnectorError('AUTH', 'Discord connection expired, please try again', { retryable: false });
    const avatarUrl = hook.avatar ? `https://cdn.discordapp.com/avatars/${hook.id}/${hook.avatar}.png` : undefined;
    return {
      creds: { accessToken: webhookUrl, tokenType: 'apikey', extra: { channelId: hook.channel_id, guildId: hook.guild_id } },
      candidates: [{ externalId: hook.id, subtype: 'webhook', displayName: hook.name || 'Discord webhook', handle: hook.channel_id ? `#${hook.channel_id}` : undefined, avatarUrl, meta: { channelId: hook.channel_id, guildId: hook.guild_id } }],
    };
  },

  async refresh(creds) { return creds; }, // webhook URLs do not expire

  async health(creds) {
    try { await fetchHook(creds.accessToken); return { ok: true }; }
    catch (e: any) { return { ok: false, reason: e?.message ?? 'Webhook rejected — it may have been deleted in Discord' }; }
  },

  publishBudget(target) {
    // Discord webhooks are rate-limited ~30 requests / 60s per webhook; stay well under.
    return [{ key: `discord:${target.channelId}:messages`, limit: 20, windowSec: 60 }];
  },

  async publish({ target, creds, channel }) {
    const md = (target.metadata ?? {}) as any;
    const content = (target.text ?? '').slice(0, MAX_CONTENT);
    const media = ((target.media as unknown as MediaRef[]) ?? []).slice(0, MAX_FILES);
    if (!content && media.length === 0) throw new ConnectorError('VALIDATION', 'A Discord message needs text or an attachment', { retryable: false });

    const payload: Record<string, any> = { content, allowed_mentions: { parse: ['users', 'roles'] } };
    if (md.username) payload.username = String(md.username).slice(0, 80);
    if (md.avatarUrl) payload.avatar_url = md.avatarUrl;
    if (md.tts) payload.tts = true;

    const url = `${creds.accessToken}?wait=true`;
    let res: Response;
    if (media.length) {
      const form = new FormData();
      form.append('payload_json', JSON.stringify(payload));
      for (let i = 0; i < media.length; i++) {
        const m = media[i];
        const bytes = await streamFromS3(m, 'clean').then(s => s.bytes);
        form.append(`files[${i}]`, new Blob([new Uint8Array(bytes)], { type: m.mime || 'application/octet-stream' }), m.assetId + guessExt(m));
      }
      res = await http(url, { method: 'POST', body: form as any });
    } else {
      res = await http(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
    }
    const msg = await readJson<{ id: string; channel_id?: string }>(res);
    if (!msg?.id) throw new ConnectorError('PLATFORM', 'Discord did not return a message id', { retryable: true, raw: msg });
    const hook: Hook = { id: target.channelId, channel_id: msg.channel_id ?? (channel?.meta as any)?.channelId, guild_id: (channel?.meta as any)?.guildId };
    return { externalId: msg.id, url: messageUrl(hook, msg.id) };
  },

  async deletePost(creds, _channel, externalId) {
    await http(`${creds.accessToken}/messages/${externalId}`, { method: 'DELETE' }).catch(() => undefined);
  },
};

function guessExt(m: MediaRef): string {
  const map: Record<string, string> = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif', 'image/webp': '.webp', 'video/mp4': '.mp4', 'video/quicktime': '.mov' };
  return map[m.mime ?? ''] ?? (m.kind === 'video' ? '.mp4' : m.kind === 'gif' ? '.gif' : '.png');
}
