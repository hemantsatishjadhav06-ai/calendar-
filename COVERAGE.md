# Blueprint → code coverage and verification status

Legend: ✅ implemented · 🟡 implemented, needs live credentials/approval to exercise · ⏭ deferred (documented in blueprint as v2)

| Blueprint part | Feature set | Where | Status |
|---|---|---|---|
| 1 Product spec | Navigation (Home, Create, Publish, Community, Insights, Start Page, Settings, ⌘K, G-shortcuts, dark mode) | apps/web/src/components/shell/*, app/(app)/layout.tsx, globals.css | ✅ |
| 1.2 Plans | Free/Essentials/Team limits, volume pricing, gating with Upgrade hints | packages/entitlements, apps/web/…/billing | ✅ |
| 1.3 Channels matrix | 12 channel types, post types, per-network fields | packages/network-rules/src/rules.ts, apps/web/…/composer/NetworkOptions.tsx | ✅ |
| 1.4 Publish | Queue/Drafts/Approvals/Sent, slots, drag/swap, shuffle, pause, notify-me, calendar week/month, composer (customize per network, threads, first comment, hashtags, AI, templates, media editor-lite, link preview/UTM/shortener), bulk CSV, IG grid + Shop Grid, posting schedule + recommended times | apps/web/src/components/publish/*, composer/*, app/(app)/channels/**, calendar/**, all-channels | ✅ (image crop/filters editor is alt-text/cover/tags only → ⏭ full canvas editor) |
| 1.5 Create/AI | Ideas board/gallery, groups, tags, generate ideas, templates library + custom, assistant actions | app/(app)/create, packages/ai, apps/api/src/ai | ✅ |
| 1.6 Insights/Analyze | Summary tiles + compare, metric sets, per-post table, hashtags, audience, takeaways, CSV/Markdown/PDF export, tag reports | apps/api/src/graphql/schema/insights.ts, app/(app)/insights, worker/metrics.processor.ts | ✅ (custom saved reports with logo → ⏭; branded PDF via print) |
| 1.7 Community | By-post/list/grid, unanswered-first, reply/like/hide/delete per network capability, saved replies, AI suggestions, bulk resolve, mentions tab, keyboard, digests, permissions | app/(app)/community, schema/community.ts, worker/inbox.processor.ts | ✅ (TikTok/Pinterest comments ⏭ — no API) |
| 1.8 Teams | Owner/Admin/Member, per-channel Publish/Community access, approvals flow, notes, 2FA + org-enforced, audit log | schema/organization.ts, posts.service.ts, auth.service.ts, settings page | ✅ (SAML via WorkOS ⏭) |
| 1.9 Start Page | Slug, 16 themes, blocks (link, text, image, grid ≤18, video, YouTube latest, Spotify, social, Mailchimp, Updates, divider), publish/unpublish, stats, contrast check | schema/startpage.ts, components/startpage/*, apps/startpage | ✅ (custom domains ⏭) |
| 1.10 Settings/API | Account, security, preferences, notifications, org, team, tags, saved replies, integrations, API keys + quotas, activity log | settings page, schema/settings.ts, rate-limit.ts | ✅ (Bitly/Canva/Drive/Dropbox OAuth flows ⏭; Unsplash/Giphy/URL import ✅) |
| 3 Architecture | Monorepo, 4 deployables + startpage + mcp, RLS tenancy, capacity | root configs, packages/db, infra/* | ✅ |
| 4 Data model | Prisma schema, RLS SQL, Timescale, vault blob | packages/db | ✅ |
| 5 Scheduling | Slot maths (DST), queue ops, dispatcher, exactly-once claim, budgets, error classes, notify flow | packages/domain, apps/worker | ✅ |
| 6 Connector framework | Interface, OAuth controller + picker, token vault, health sweep | packages/connectors/src/types.ts, apps/api/src/oauth, packages/token-vault, worker/housekeeping | ✅ |
| 7 Connectors | FB, IG, Threads, X, LinkedIn, TikTok, YouTube, Pinterest, GBP, Bluesky, Mastodon | packages/connectors/src/** | 🟡 (complete code; each needs real app credentials + platform approval to run) |
| 8 Media | Direct-to-S3 multipart upload, probe/EXIF strip/thumbs, lazy per-network renditions, validation engine | apps/api/src/uploads, worker/media.*, packages/network-rules/validate.ts | ✅ |
| 9 Composer services | UTM, relay/Bitly shortening, OG preview, hashtag manager, templates, bulk CSV | apps/api/src/links/*, composer panels, channels/[id]/bulk | ✅ |
| 10 Analytics pipeline | Daily channel pull, post bootstrap/refresh cadence, native-post discovery, story insights, hashtag perf, best-time | worker/metrics.processor.ts, insights.ts, ChannelSettings recommend | ✅ (best-time uses seeded recommendation until ≥20 posts; z-score model in blueprint ⏭ to data pkg) |
| 11 Inbox | Webhook store-then-process, pollers per network, enrichment, triage, SSE | webhooks.controller.ts, inbox.processor.ts | ✅ |
| 12 AI | Provider-agnostic gateway, assistant actions, triage, reply suggestions, takeaways, embeddings, cost ledger | packages/ai, apps/api/src/ai | ✅ |
| 13 Start Page hosting | Public host, cache, click tracking, revalidate | apps/startpage | ✅ |
| 14 RBAC | authz matrix, invites, org switch, multiple orgs | packages/domain/authz.ts, organization.ts | ✅ (agency cross-org dashboard ⏭) |
| 15 Billing | Stripe graduated per-channel, trial, checkout, change, proration, quantity sync, locks, portal, webhooks | apps/api/src/billing | 🟡 (needs Stripe keys/prices) |
| 16 Public API/MCP | Bearer keys, scopes, quotas, GraphQL, MCP 13 tools, developers doc | rate-limit.ts, session.middleware.ts, apps/mcp, developers/README.md | ✅ (OAuth app clients for third parties ⏭ — schema tables exist) |
| 17 Front-end/design | Tokens, dark mode, components, every screen | apps/web | ✅ |
| 18 Accessibility | Labels, roles, keyboard alternatives, live regions, contrast check, axe E2E | throughout; e2e/publish.spec.ts | ✅ (external audit/VPAT ⏭) |
| 19 Infra | docker-compose, Dockerfile, Helm + KEDA + migrate job + ingress, Terraform AWS, CI | infra/*, .github/workflows | ✅ |
| 20 Testing | Contention, RLS, rules, slots, entitlements, connector helpers, E2E + axe | *.test.ts, apps/web/e2e | ✅ written · ❌ not yet executed (see below) |
| 21 App reviews | Checklist | README + blueprint Part 21 | ✅ documented (approvals are a human process) |

## Verification performed
- **Static review by two independent reviewer passes** over the whole repo (imports/exports, Prisma model/field parity, GraphQL document ↔ schema parity for 35 queries and 64 mutations, REST route ↔ client parity, hook rules, prop contracts). Findings (2 schema-breaking imports, missing deps, BigInt cursor, Suspense boundaries, FREE-plan comparison guard, duplicate media listeners, edit-mode reschedule, TikTok permalink, Meta pagination, dead code) were all fixed.
- **Not performed:** `pnpm install/typecheck/test`, Playwright, or any live network call — the authoring environment had no shell. HANDOFF.md step 1 covers this; expect a short list of residual TypeScript nits (Pothos generics, a few `any` casts).
