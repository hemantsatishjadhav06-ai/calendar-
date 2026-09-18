import { describe, expect, it } from 'vitest';
import { isWebhookUrl, messageUrl } from './discord.js';

describe('Discord webhook URL validation', () => {
  it('accepts canonical webhook URLs (with optional api version + subdomains)', () => {
    expect(isWebhookUrl('https://discord.com/api/webhooks/123456789/abcDEF-_token')).toBe(true);
    expect(isWebhookUrl('https://discord.com/api/v10/webhooks/123/tok-en_1')).toBe(true);
    expect(isWebhookUrl('https://canary.discord.com/api/webhooks/1/tok')).toBe(true);
    expect(isWebhookUrl('https://discordapp.com/api/webhooks/1/tok')).toBe(true);
    expect(isWebhookUrl('  https://discord.com/api/webhooks/1/tok  ')).toBe(true);
  });
  it('rejects non-webhook URLs', () => {
    expect(isWebhookUrl('https://discord.com/channels/1/2/3')).toBe(false);
    expect(isWebhookUrl('http://discord.com/api/webhooks/1/tok')).toBe(false); // not https
    expect(isWebhookUrl('https://evil.com/api/webhooks/1/tok')).toBe(false);
    expect(isWebhookUrl('not a url')).toBe(false);
  });
});

describe('Discord message permalink', () => {
  it('builds a channel permalink when guild + channel are known', () => {
    expect(messageUrl({ id: 'w', guild_id: '111', channel_id: '222' }, '999')).toBe('https://discord.com/channels/111/222/999');
  });
  it('returns undefined without guild/channel context', () => {
    expect(messageUrl({ id: 'w' }, '999')).toBeUndefined();
    expect(messageUrl({ id: 'w', channel_id: '222' }, '999')).toBeUndefined();
  });
});
