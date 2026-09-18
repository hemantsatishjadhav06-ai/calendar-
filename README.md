# Relay — a Buffer-equivalent social media platform

Publish · Create · Community · Insights · Start Page · AI Assistant · Teams · Billing · Public GraphQL API · MCP server.
Multi-tenant (one organization per client company; designed for 30+ running simultaneously). TypeScript end to end.

> Companion document: `../Buffer-Clone-Engineering-Blueprint.html` (open → Ctrl+P → Save as PDF, or run `../Make-PDF.bat`).
> The blueprint explains every decision in this repo; this README tells you how to run it.

## Repository map

```
apps/
  web/        Next.js 15 app — shell, composer, queue, calendar, ideas, community, insights, settings, billing, start-page editor
  api/        NestJS + GraphQL Yoga (Pothos) — auth, tenancy (RLS), OAuth, uploads, webhooks, Stripe, AI endpoints, SSE
  worker/     BullMQ processors — dispatcher, publish (exactly-once), notify, media (sharp/ffmpeg), metrics, inbox, housekeeping, ai
  startpage/  Public *.start.<domain> host (Hono) with click tracking
  mcp/        MCP server (Streamable HTTP) wrapping the public API
packages/
  config      Zod-validated env + feature flags
  db          Prisma schema, RLS + Timescale SQL, tenant-scoped client, seed
  domain      Slot maths, queue ops, authz, errors
  entitlements Plan → feature/limit matrix, graduated pricing
  network-rules Per-network limits + shared validator (browser & worker)
  connectors  Facebook, Instagram, Threads, X, LinkedIn, TikTok, YouTube, Pinterest, Google Business, Bluesky, Mastodon, Start Page
  token-vault KMS envelope encryption for social tokens, refresh locking
  ai          Provider-agnostic assistant, triage, reply suggestions, embeddings, takeaways
  mail        Transactional email templates (Resend/SES)
  graphql     Public schema snapshot + breaking-change check
infra/        docker-compose (dev), Dockerfile, Helm chart (+KEDA), Terraform (AWS)
```

## Run locally (10 minutes)

Prerequisites: Node 22, pnpm 9, Docker Desktop, ffmpeg on PATH (for the media worker).

```bash
cp .env.example .env                 # fill in at least SESSION_SECRET (32+ chars); network keys are optional to start
pnpm install
pnpm infra:up                        # Postgres+Timescale, Redis, MinIO (S3), Mailpit
pnpm db:generate && pnpm db:migrate  # Prisma migrations
pnpm --filter @relay/db exec node --import tsx scripts/apply-sql.ts   # RLS policies, hypertables, vault table
pnpm db:seed                         # org "acme", login owner@relay.local / password
pnpm dev                             # web :3000 · api :4000 · worker · startpage :4100 · mcp :4200
```

Open http://localhost:3000 → sign in → **Channels → Connect**. Without platform keys you can still exercise the full product using the seed data, drafts, ideas, the Start Page editor and the notify-me flow. To publish for real, register apps per network (see *Platform setup*) and paste the keys into `.env`.

Mail goes to Mailpit at http://localhost:8025. MinIO console at http://localhost:9001 (minio / minio12345).

## Platform setup (start these first — they are the critical path)

| Network | Where | Must have | Time |
|---|---|---|---|
| Meta (FB Pages, Instagram, Threads) | developers.facebook.com → Business app | Business Verification → App Review per permission → **Tech Provider / Access Verification** → Live. Webhooks: `https://<api>/webhooks/facebook`, `/webhooks/instagram`, `/webhooks/threads`. Data deletion: `/webhooks/meta-deletion`. | 2–6 weeks |
| X | console.x.com | Pay-per-use billing, OAuth 2.0 app (Web App, confidential). Optional Account Activity API → `/webhooks/x`. | same day |
| LinkedIn | linkedin.com/developers | Share on LinkedIn + OpenID (instant). **Community Management API** Dev tier on a fresh app → Standard tier within 12 months. Webhook `/webhooks/linkedin`. | 2–4 weeks |
| TikTok | developers.tiktok.com | Login Kit, Content Posting API, Display API, Webhooks; verify the media domain (`MEDIA_CDN_BASE`) for PULL_FROM_URL; app audit. Unaudited = private posts only. | 1–3 weeks |
| Google (YouTube, GBP) | console.cloud.google.com | OAuth verification for sensitive scopes; YouTube quota extension (100 uploads/day/project by default); Business Profile API access request. | 2–8 weeks |
| Pinterest | developers.pinterest.com | Trial → Standard access. | 1–3 weeks |
| Bluesky | — | Set `BSKY_PRIVATE_KEY_1` (ES256 JWK); metadata is served at `/oauth/bluesky/client-metadata.json`. | none |
| Mastodon | — | Nothing; apps register per instance at runtime. | none |

Feature flags in `packages/config` keep TikTok/YouTube/GBP hidden until approvals land.

## Key design guarantees (read before touching the scheduler)

- **Exactly-once publishing.** `apps/worker/src/publish.processor.ts` claims a target with `UPDATE … WHERE status IN ('QUEUED','SCHEDULED') … RETURNING`. Only the claimer publishes. Jobs are idempotent (`jobId = targetId:dueAtEpoch`). Redis can be wiped at any time; the dispatcher rebuilds from Postgres. Test: `apps/worker/src/publish.processor.test.ts`.
- **Tenant isolation.** Every tenant table has RLS keyed by `app.org_id`; the API uses the `relay` role through `tenantClient()`. Workers use `relay_admin` (bypass) and must filter by `organizationId`. Only `relay_vault` can read `ChannelCredential`. Test: `packages/db/src/rls.test.ts`.
- **Validation once, in one place.** `packages/network-rules` runs in the composer (live) and again in the API and worker. If a network rule changes, change it there only.
- **Failure classes drive UX.** `AUTH` pauses the channel (RECONNECT_REQUIRED), `RATE_LIMIT`/`PLATFORM`/`NETWORK` defer with backoff, `MEDIA`/`VALIDATION`/`POLICY` fail fast with a specific message.
- **Version pins.** `GRAPH_VERSION` (packages/connectors/src/meta/graph.ts), `LI_VERSION` (env). Bump quarterly after running the connector tests.

## Scripts

```bash
pnpm typecheck | pnpm lint | pnpm test          # all packages
pnpm --filter @relay/web exec playwright test   # E2E + axe (needs dev stack)
pnpm --filter @relay/api run schema:emit        # regenerate apps/api/schema.graphql
pnpm --filter @relay/graphql run schema:check   # fail on breaking public-API change
WORKER_ROLE=media pnpm --filter @relay/worker dev   # run one worker role
```

## Deploy

CI (`.github/workflows/ci.yml`) builds one image per app to GHCR. `infra/helm/relay` deploys web/api/ingest/worker/media/startpage/mcp with KEDA autoscaling (publish queue depth + top-of-hour pre-warm) and a PreSync migration Job. `infra/terraform` provisions VPC, EKS, RDS Postgres 16, ElastiCache Redis 7, S3 + CloudFront (signed URLs), KMS, SES. Set `KMS_TOKEN_KEY_ARN` in production; `LOCAL_MASTER_KEY_HEX` is refused when `NODE_ENV=production`.

Timescale note: RDS ships the Apache-2 TimescaleDB edition (hypertables yes; continuous aggregates/compression no). `post_metric_current` is a plain view so Insights works either way; for full Timescale use Timescale Cloud or self-managed Postgres.

## Status of this codebase

Written as a complete, coherent implementation of the blueprint but **not yet compiled or run** in this environment (the authoring sandbox had no shell). Expect a first `pnpm typecheck` to surface small issues (import paths, Pothos generics, a few `any` casts) — budget a day for that pass, then the integration tests above become the real gate. See `HANDOFF.md` for the ordered checklist.
