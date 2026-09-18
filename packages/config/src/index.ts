import { config as loadDotenv } from 'dotenv';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { z } from 'zod';

// Load the nearest `.env` by walking up from the current working directory.
// In this monorepo each package runs with its own directory as cwd (turbo,
// vitest), so a plain `dotenv/config` would miss the root `.env`. Walking up
// finds it whether we're run from the repo root or from a package/app folder,
// and falls back to real process env in production (where no file exists).
function loadNearestDotenv(): void {
  let dir = process.cwd();
  for (let i = 0; i < 8; i++) {
    const candidate = join(dir, '.env');
    if (existsSync(candidate)) {
      loadDotenv({ path: candidate });
      return;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  loadDotenv();
}
loadNearestDotenv();

const optional = z.string().optional().transform(v => (v === '' ? undefined : v));

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_URL: z.string().url().default('http://localhost:3000'),
  API_URL: z.string().url().default('http://localhost:4000'),
  SHORT_BASE: z.string().default('http://localhost:4000/r'),
  MEDIA_CDN_BASE: z.string().default('http://localhost:9000/relay-media'),
  SESSION_SECRET: z.string().min(32),
  DATABASE_URL: z.string(),
  DATABASE_URL_ADMIN: z.string(),
  DATABASE_URL_VAULT: z.string(),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  S3_ENDPOINT: optional,
  S3_BUCKET: z.string().default('relay-media'),
  S3_REGION: z.string().default('us-east-1'),
  S3_ACCESS_KEY: optional,
  S3_SECRET_KEY: optional,
  KMS_TOKEN_KEY_ARN: optional,
  LOCAL_MASTER_KEY_HEX: optional,

  META_APP_ID: optional, META_APP_SECRET: optional, META_LOGIN_CONFIG_ID: optional, META_WEBHOOK_VERIFY_TOKEN: z.string().default('relay-verify'),
  IG_APP_ID: optional, IG_APP_SECRET: optional, THREADS_APP_ID: optional, THREADS_APP_SECRET: optional,
  X_CLIENT_ID: optional, X_CLIENT_SECRET: optional, X_CONSUMER_KEY: optional, X_CONSUMER_SECRET: optional, X_SPEND_CAP_USD_PER_ORG: z.coerce.number().default(50),
  LI_CLIENT_ID: optional, LI_CLIENT_SECRET: optional, LI_VERSION: z.string().default('202509'),
  TT_CLIENT_KEY: optional, TT_CLIENT_SECRET: optional,
  GOOGLE_CLIENT_ID: optional, GOOGLE_CLIENT_SECRET: optional, GOOGLE_PICKER_API_KEY: optional, YT_HUB_SECRET: z.string().default('relay-yt-hub'), GBP_PUBSUB_TOPIC: optional,
  PIN_APP_ID: optional, PIN_APP_SECRET: optional, PIN_SANDBOX: z.coerce.boolean().default(false),
  BSKY_PRIVATE_KEY_1: optional, BSKY_JETSTREAM_URL: optional,
  STRIPE_SECRET_KEY: optional, STRIPE_WEBHOOK_SECRET: optional,
  STRIPE_PRICE_ESSENTIALS_MONTHLY: optional, STRIPE_PRICE_ESSENTIALS_YEARLY: optional, STRIPE_PRICE_TEAM_MONTHLY: optional, STRIPE_PRICE_TEAM_YEARLY: optional,
  AI_PROVIDER: z.enum(['openai', 'anthropic']).default('openai'), OPENAI_API_KEY: optional, ANTHROPIC_API_KEY: optional,
  UNSPLASH_ACCESS_KEY: optional, GIPHY_API_KEY: optional, CANVA_CLIENT_ID: optional, CANVA_CLIENT_SECRET: optional, DROPBOX_APP_KEY: optional,
  BITLY_CLIENT_ID: optional, BITLY_CLIENT_SECRET: optional, MAILCHIMP_CLIENT_ID: optional, MAILCHIMP_CLIENT_SECRET: optional,
  RESEND_API_KEY: optional, MAIL_FROM: z.string().default('Cadence <no-reply@relay.local>'),
  SENTRY_DSN: optional, OTEL_EXPORTER_OTLP_ENDPOINT: optional, WORKOS_API_KEY: optional, WORKOS_CLIENT_ID: optional,
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;
export function loadEnv(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map(i => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment:\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}
export const env: Env = new Proxy({} as Env, { get: (_t, k) => (loadEnv() as any)[k as string] });

/** Feature flags: static defaults overridable per organization via the FeatureFlag table (see @cadence/db). */
export const DEFAULT_FLAGS = {
  network_tiktok: false,        // enable after TikTok audit
  network_youtube: false,       // enable after quota extension
  network_gbp: false,           // enable after API access approval
  community_ai_triage: true,
  insights_v2: true,
  start_page: true,
  public_api: true,
} as const;
export type FlagKey = keyof typeof DEFAULT_FLAGS;
