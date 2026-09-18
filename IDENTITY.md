# Cadence — identity & lineage

**Cadence** is a self-hostable, multi-tenant social media management platform: plan, compose,
schedule, approve, publish, and measure content across every major network from one workspace.
It is built for creators, agencies, and SMBs who would rather own their social stack than rent it
from a per-seat SaaS.

This repository is the single, coherent product. It grew out of three earlier explorations of the
same idea, each in a different stack, which were studied and unified here:

| Lineage source | Stack | What it contributed to Cadence |
|---|---|---|
| **shoutrrr** (`coollabsio/shoutrrr`) | Laravel / PHP + Inertia/React | Self-hostable scheduling & publishing model for X, Bluesky, LinkedIn; MCP surface; billing via a first-party cashier. |
| **BrightBean Studio** (`brightbeanxyz/brightbean-studio`) | Python / Django | The full feature surface — multi-workspace teams, approval workflows, unified inbox, analytics, media library, client portal, white-label branding — and the broad first-party platform matrix. |
| **Relay** (this repo's TypeScript base) | Next.js + NestJS + BullMQ | The end-to-end TypeScript architecture: exactly-once publishing, RLS tenancy, KMS token vault, public GraphQL API. |

Cadence keeps the TypeScript architecture as its backbone and folds in the complete feature and
platform coverage of the other two, under one identity.

## Feature parity map

Every capability of the two reference products is present in Cadence:

| Capability | shoutrrr | BrightBean | **Cadence** | Where in Cadence |
|---|:---:|:---:|:---:|---|
| Multi-workspace / teams / RBAC | — | ✓ | ✓ | `Organization`, `Agency`, `Membership` (`OrgRole`), `ChannelGrant` |
| Content composer (per-network overrides) | ✓ | ✓ | ✓ | `apps/web` composer, `@cadence/network-rules` |
| Calendar, queues & recurring slots | ✓ | ✓ | ✓ | `PostingSlot`, `@cadence/domain` slot maths, calendar view |
| Publishing engine (direct first-party APIs) | ✓ | ✓ | ✓ | `apps/worker` publish processor (exactly-once) |
| Approval workflows | — | ✓ | ✓ | `Approval`, `PostStatus.PENDING_APPROVAL`, `PublishAccess.APPROVAL` |
| Unified social inbox | — | ✓ | ✓ | `Comment`, `SavedReply`, connector `pollInbox`/`reply` |
| Analytics / insights | ✓ | ✓ | ✓ | `PostMetric`, `ChannelMetricDaily`, `AudienceSnapshot`, Insights view |
| Media library (+ Unsplash/GIPHY) | — | ✓ | ✓ | `Asset`, media tray, `UNSPLASH_ACCESS_KEY`/`GIPHY_API_KEY` |
| Idea board (Kanban) | — | ✓ | ✓ | `Idea`, `IdeaGroup` |
| Client portal / magic-link share | — | ✓ | ✓ | `share/[token]`, `notify/[id]`, `Approval` |
| Notifications (in-app / email / webhook) | — | ✓ | ✓ | `NotificationJob`, `NotificationPref`, `@cadence/mail`, webhooks |
| Billing (graduated, per-channel) | ✓ | — | ✓ | `Subscription`, `SpendLedger`, `@cadence/entitlements`, Stripe |
| Public API + MCP server | ✓ | — | ✓ | `apps/mcp`, `@cadence/graphql`, `ApiKey`, `OAuthClient` |
| Start Page / link-in-bio | — | — | ✓ | `StartPage`, `apps/startpage` |
| Encrypted token/credential storage | ✓ | ✓ | ✓ | `@cadence/token-vault` (KMS envelope encryption) |
| Tenant isolation (RLS) | — | — | ✓ | `@cadence/db` Postgres row-level security |

## Platform coverage

Cadence ships connectors for **Facebook, Instagram, Threads, X, LinkedIn, TikTok, YouTube,
Pinterest, Google Business Profile, Bluesky, Mastodon** and its own **Start Page** — a superset of
shoutrrr's three networks and matching BrightBean's matrix.

**Roadmap gap:** BrightBean additionally publishes to **DEV.to**. DEV.to uses a per-user API-key
auth model rather than the OAuth flow every current Cadence connector uses, so it is tracked as a
follow-up connector rather than shipped half-wired. The connector registry
(`packages/connectors/src/index.ts`) is the single place it would be added.

## What is verified in this build

- `pnpm typecheck` — green across all 14 packages.
- `pnpm lint` — green (0 errors; the strict `jsx-a11y` set is honoured).
- Unit suites (`@cadence/domain`, `entitlements`, `network-rules`, `token-vault`, `connectors`) — green.
- Integration suites against Postgres + Redis: tenant-isolation RLS (`@cadence/db`) and the
  exactly-once publish guarantee (`@cadence/worker`) — green (36 tests total).
- `pnpm build` — all five applications compile; the web app builds all 15 routes.
- The full stack (web + api + worker) boots and serves against Postgres + Redis, seeded via
  `pnpm db:seed` (login `owner@relay.local` / `password`).
- Playwright + axe E2E: the **accessibility suite passes** — zero critical/serious WCAG 2 A/AA
  violations across all nine authenticated pages, in a real browser against the running app.
  (Three real accessibility defects were found and fixed along the way: two colour-contrast
  tokens and the calendar's ARIA grid structure.)

### Known gaps (not blockers to the above)

- The E2E golden-path publish tests assume a `CONNECTOR_MOCK` mock network and a seeded channel
  that are not yet implemented, so those specific specs can't run here yet.
- The `/api/events` SSE endpoint returns 500 and soft-navigation into `/community` is affected;
  full-page loads of `/community` render fine (and pass axe).
- Docker image pulls are blocked in the authoring sandbox, so MinIO/mailpit and the container
  build path were exercised via a local Postgres/Redis instead of `docker compose`.

See `HANDOFF.md` for the operational checklist and `README.md` to run it.
