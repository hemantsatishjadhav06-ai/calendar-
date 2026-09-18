import type { Network } from '@relay/db';
import type { SocialConnector } from './types.js';
import { facebook } from './meta/facebook.js';
import { instagram } from './meta/instagram.js';
import { threads } from './meta/threads.js';
import { x } from './x/x.js';
import { linkedin } from './linkedin/linkedin.js';
import { tiktok } from './tiktok/tiktok.js';
import { youtube } from './google/youtube.js';
import { gbp } from './google/gbp.js';
import { pinterest } from './pinterest/pinterest.js';
import { bluesky } from './bluesky/bluesky.js';
import { mastodon } from './mastodon/mastodon.js';
import { startPage } from './startpage/startpage.js';

export * from './types.js';
export { ConnectorError, classifyError, type FailureCode } from './shared/errors.js';
export { parseSignedRequest, verifyMetaWebhook } from './meta/graph.js';
export { clientMetadata as blueskyClientMetadata, jwks as blueskyJwks } from './bluesky/bluesky.js';
export { normalizeHost as normalizeMastodonHost } from './mastodon/mastodon.js';

const registry: Record<Network, SocialConnector> = {
  FACEBOOK: facebook, INSTAGRAM: instagram, THREADS: threads, X: x, LINKEDIN: linkedin, TIKTOK: tiktok, YOUTUBE: youtube,
  PINTEREST: pinterest, GOOGLE_BUSINESS: gbp, BLUESKY: bluesky, MASTODON: mastodon, START_PAGE: startPage,
};

export function getConnector(network: Network): SocialConnector {
  const c = registry[network];
  if (!c) throw new Error(`No connector for ${network}`);
  return c;
}
export const allNetworks = Object.keys(registry) as Network[];

/** Networks the connect screen offers, with display metadata. */
export const NETWORK_CATALOG: { network: Network; label: string; needsHint?: 'server' | 'handle'; note?: string }[] = [
  { network: 'FACEBOOK', label: 'Facebook Page', note: 'Pages you manage; Groups via notifications' },
  { network: 'INSTAGRAM', label: 'Instagram', note: 'Business or Creator account' },
  { network: 'THREADS', label: 'Threads' },
  { network: 'X', label: 'X' },
  { network: 'LINKEDIN', label: 'LinkedIn', note: 'Profile and Pages you administer' },
  { network: 'TIKTOK', label: 'TikTok' },
  { network: 'YOUTUBE', label: 'YouTube Shorts' },
  { network: 'PINTEREST', label: 'Pinterest', note: 'Business account recommended' },
  { network: 'GOOGLE_BUSINESS', label: 'Google Business Profile' },
  { network: 'BLUESKY', label: 'Bluesky', needsHint: 'handle' },
  { network: 'MASTODON', label: 'Mastodon', needsHint: 'server' },
];
