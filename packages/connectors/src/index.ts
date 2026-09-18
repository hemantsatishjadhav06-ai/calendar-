import type { Network } from '@cadence/db';
import { env } from '@cadence/config';
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
import { devto } from './devto/devto.js';
import { startPage } from './startpage/startpage.js';

export * from './types.js';
export { ConnectorError, classifyError, type FailureCode } from './shared/errors.js';
export { parseSignedRequest, verifyMetaWebhook } from './meta/graph.js';
export { clientMetadata as blueskyClientMetadata, jwks as blueskyJwks } from './bluesky/bluesky.js';
export { normalizeHost as normalizeMastodonHost } from './mastodon/mastodon.js';

const registry: Record<Network, SocialConnector> = {
  FACEBOOK: facebook, INSTAGRAM: instagram, THREADS: threads, X: x, LINKEDIN: linkedin, TIKTOK: tiktok, YOUTUBE: youtube,
  PINTEREST: pinterest, GOOGLE_BUSINESS: gbp, BLUESKY: bluesky, MASTODON: mastodon, DEVTO: devto, START_PAGE: startPage,
};

export function getConnector(network: Network): SocialConnector {
  const c = registry[network];
  if (!c) throw new Error(`No connector for ${network}`);
  return c;
}
export const allNetworks = Object.keys(registry) as Network[];

/**
 * Whether the PRODUCT-level app credentials for a network are configured (Buffer-style: one app per
 * network, shared by every organization). When true the connect flow works and every client can
 * self-connect by clicking "Allow"; when false the connect screen shows the network as not-yet-set-up
 * instead of erroring. Bluesky and Mastodon need no product app (they self-register per user/instance).
 */
const CREDENTIALS: Record<Network, () => boolean> = {
  FACEBOOK: () => !!(env.META_APP_ID && env.META_APP_SECRET),
  INSTAGRAM: () => !!(env.IG_APP_ID && env.IG_APP_SECRET),
  THREADS: () => !!(env.THREADS_APP_ID && env.THREADS_APP_SECRET),
  X: () => !!(env.X_CLIENT_ID && env.X_CLIENT_SECRET),
  LINKEDIN: () => !!(env.LI_CLIENT_ID && env.LI_CLIENT_SECRET),
  TIKTOK: () => !!(env.TT_CLIENT_KEY && env.TT_CLIENT_SECRET),
  YOUTUBE: () => !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET),
  GOOGLE_BUSINESS: () => !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET),
  PINTEREST: () => !!(env.PIN_APP_ID && env.PIN_APP_SECRET),
  BLUESKY: () => true,
  MASTODON: () => true,
  DEVTO: () => true,      // no product app: each user connects with their own DEV.to API key
  START_PAGE: () => true,
};
export function networkConfigured(network: Network): boolean {
  return (CREDENTIALS[network] ?? (() => false))();
}

/** Networks the connect screen offers, with display metadata. */
export const NETWORK_CATALOG: { network: Network; label: string; needsHint?: 'server' | 'handle' | 'apikey'; note?: string }[] = [
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
  { network: 'DEVTO', label: 'DEV.to', needsHint: 'apikey', note: 'Publish articles with your DEV.to API key' },
];
