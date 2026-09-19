import { Redis } from 'ioredis';
import { env } from '@cadence/config';

export interface LinkPreview { url: string; title?: string; description?: string; image?: string; siteName?: string }

const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });

/** Fetch Open Graph / Twitter card metadata (cached 24h). Media is imported into an Asset by the caller when the user keeps the card. */
export async function fetchPreview(url: string): Promise<LinkPreview> {
  const key = `preview:${url}`;
  const cached = await redis.get(key); if (cached) return JSON.parse(cached);
  const u = new URL(url);
  if (!/^https?:$/.test(u.protocol) || /^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(u.hostname)) throw new Error('Unsupported URL');   // SSRF guard
  const res = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 (compatible; RelayBot/1.0; +https://relay.app/bot)', accept: 'text/html' }, redirect: 'follow', signal: AbortSignal.timeout(8000) });
  const html = (await res.text()).slice(0, 512_000);
  const meta = (names: string[]) => { for (const n of names) { const m = html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${n}["'][^>]+content=["']([^"']*)["']`, 'i')) ?? html.match(new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${n}["']`, 'i')); if (m?.[1]) return decode(m[1]); } return undefined; };
  const preview: LinkPreview = {
    url: res.url || url,
    title: meta(['og:title', 'twitter:title']) ?? (decode(html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] ?? '') || undefined),
    description: meta(['og:description', 'twitter:description', 'description']),
    image: abs(meta(['og:image', 'og:image:url', 'twitter:image']), res.url || url),
    siteName: meta(['og:site_name']) ?? u.hostname,
  };
  await redis.setex(key, 86400, JSON.stringify(preview));
  return preview;
}
const decode = (s: string) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").trim();
const abs = (src: string | undefined, base: string) => { if (!src) return undefined; try { return new URL(src, base).toString(); } catch { return undefined; } };
