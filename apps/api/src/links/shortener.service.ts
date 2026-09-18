import { customAlphabet } from 'nanoid';
import { prismaAdmin, type Channel } from '@cadence/db';
import { env } from '@cadence/config';
import { extractUrls, unique } from '@cadence/domain';
import { keyProvider, open } from '@cadence/token-vault';

const slugId = customAlphabet('23456789abcdefghjkmnpqrstuvwxyz', 7);
const NO_SHORTEN_NETWORKS = new Set(['PINTEREST', 'GOOGLE_BUSINESS']);

export interface LinkSettings { linkShortener?: 'relay' | 'bitly' | 'none'; utm?: { enabled?: boolean } & Record<string, string | boolean | undefined>; excludeDomains?: string[]; gaTracking?: boolean }

export class ShortenerService {
  async processText(text: string, opts: { organizationId: string; channel: Channel; postTargetId: string; tagName?: string }): Promise<{ text: string; links: { original: string; short: string; slug?: string }[] }> {
    const org = await prismaAdmin.organization.findUniqueOrThrow({ where: { id: opts.organizationId } });
    const settings: LinkSettings = { ...((org.settings as any) ?? {}), ...(((opts.channel.meta as any)?.linkSettings) ?? {}) };
    const urls = unique(extractUrls(text)).filter(u => /^https?:\/\//i.test(u));
    const links: { original: string; short: string; slug?: string }[] = [];
    let out = text;
    for (const url of urls) {
      let target = url;
      if (settings.utm?.enabled) target = applyUtm(target, settings.utm as any, { network: opts.channel.network.toLowerCase(), channel: opts.channel.handle ?? opts.channel.displayName, tag: opts.tagName ?? '' });
      let short = target;
      const excluded = NO_SHORTEN_NETWORKS.has(opts.channel.network) || (settings.excludeDomains ?? []).some(d => new URL(url).hostname.endsWith(d));
      if (!excluded && settings.linkShortener === 'relay') short = await this.relay(target, opts);
      else if (!excluded && settings.linkShortener === 'bitly') short = await this.bitly(target, opts.organizationId).catch(() => target);
      if (short !== url) out = out.split(url).join(short);
      links.push({ original: url, short, slug: short.startsWith(env.SHORT_BASE) ? short.split('/').pop() : undefined });
    }
    return { text: out, links };
  }

  private async relay(target: string, opts: { organizationId: string; postTargetId: string }) {
    const slug = slugId();
    await prismaAdmin.shortLink.create({ data: { organizationId: opts.organizationId, slug, targetUrl: target, postTargetId: opts.postTargetId, provider: 'relay' } });
    return `${env.SHORT_BASE}/${slug}`;
  }

  private async bitly(target: string, organizationId: string) {
    const integ = await prismaAdmin.integration.findUnique({ where: { organizationId_provider: { organizationId, provider: 'bitly' } } });
    if (!integ) return target;
    const dek = await keyProvider().unwrap(Buffer.from(integ.dekEnc), `integration:${integ.id}`);
    const token = open(Buffer.from(integ.credentialEnc), dek); dek.fill(0);
    const meta = (integ.meta as any) ?? {};
    const r = await fetch('https://api-ssl.bitly.com/v4/shorten', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ long_url: target, group_guid: meta.groupGuid, domain: meta.domain ?? 'bit.ly' }) });
    const j: any = await r.json();
    if (!j.link) throw new Error(`Bitly: ${j.description ?? j.message ?? r.status}`);
    return j.link as string;
  }
}

export function applyUtm(url: string, utm: Record<string, string | boolean | undefined>, vars: Record<string, string>) {
  try {
    const u = new URL(url);
    for (const [k, v] of Object.entries(utm)) if (k.startsWith('utm_') && typeof v === 'string' && v && !u.searchParams.has(k)) u.searchParams.set(k, v.replace(/\{(\w+)\}/g, (_, n) => vars[n] ?? ''));
    return u.toString();
  } catch { return url; }
}
