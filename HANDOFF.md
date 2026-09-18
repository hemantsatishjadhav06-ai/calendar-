# Engineering handoff — first two weeks

See `COVERAGE.md` for the blueprint→code map and what has (and has not) been verified.

## Week 1: make it compile, boot and publish once
1. `pnpm install` → `pnpm typecheck`. Fix in this order: `packages/config` → `db` → `domain` → `network-rules` → `entitlements` → `token-vault` → `connectors` → `ai` → `mail` → `apps/api` → `apps/worker` → `apps/web` → `startpage` → `mcp`. Known hotspots: Pothos plugin generics in `apps/api/src/graphql/builder.ts` (needs `pnpm db:generate` first so `@pothos/plugin-prisma/generated` exists), `tenantClient` extension typing, Next.js route typing for `[[...section]]`.
2. `pnpm infra:up && pnpm db:migrate && apply-sql && pnpm db:seed`, then `pnpm dev`. Log in, create a draft, verify the composer validation matches the network-rules tests.
3. Register **one** Meta Business app in Development mode with your own Page/IG test account (Standard Access works for role users). Connect Facebook + Instagram, add a post to the queue, watch `worker` publish it. Then X (pay-per-use, ~$0.02) and LinkedIn (Share on LinkedIn, personal profile).
4. Run `apps/worker/src/publish.processor.test.ts` and `packages/db/src/rls.test.ts` against the dev DB — both must be green before any other feature work.
5. File platform reviews (Meta Business Verification + App Review + Tech Provider; LinkedIn Community Management; TikTok; Google OAuth; GBP). Paperwork checklist is Part 21 of the blueprint.

## Week 2: production shape
6. Terraform `envs/staging.tfvars`, push images, Helm install, point `hooks.<domain>` at ingest and register webhook URLs in each developer portal.
7. Record connector cassettes (Polly.js) from the staging accounts so CI runs contract tests without live credentials; schedule the nightly re-record job.
8. Sentry + OpenTelemetry exporters (env already wired), dashboards for `publish_lag_seconds` and `publish_result_total{network,code}`.
9. Load test with k6: 3,000 due targets at one instant with the connector mocked → p99 publish lag < 60 s; run the Redis-flush game day.
10. Accessibility pass: `playwright test` (axe), NVDA/VoiceOver on composer, queue reorder via ⋯ menu, calendar drag alternative.

## Deliberately deferred (documented in the blueprint)
- Mobile apps and browser extension (deep link `?compose=1&text=&url=` is already handled by the composer store).
- TikTok comments (needs TikTok Business Account API), Pinterest comments (no API), LinkedIn comment hiding (no API).
- Custom domains for Start Pages, scheduled report emails, Comment Insights Q&A, SAML via WorkOS (env vars reserved).
- Public webhooks for the API (Buffer parity is polling; add signed webhooks in v2).

## Where things live (quick index)
| Concern | File |
|---|---|
| Queue slot maths / DST | `packages/domain/src/scheduling/slots.ts` |
| Queue operations (share next, shuffle, swap) | `packages/domain/src/scheduling/queue-ops.ts` |
| Publish claim + retry policy | `apps/worker/src/publish.processor.ts` |
| Dispatcher look-ahead | `apps/worker/src/dispatcher.ts` |
| Rate budgets (IG 100/day, Threads 250, TikTok 15, X spend) | `apps/worker/src/rate-budget.ts` + each connector's `publishBudget` |
| Network limits | `packages/network-rules/src/rules.ts` |
| Composer (live validation, per-network tabs) | `apps/web/src/components/composer/` |
| Post creation (entitlements, approvals, shortening) | `apps/api/src/posts/posts.service.ts` |
| Token encryption/refresh | `packages/token-vault/src/index.ts` |
| Webhook intake (fast ACK) | `apps/api/src/webhooks/webhooks.controller.ts` → `apps/worker/src/inbox.processor.ts` |
| Metrics collection cadence | `apps/worker/src/metrics.processor.ts` |
| Insights SQL | `apps/api/src/graphql/schema/insights.ts` |
| Stripe lifecycle | `apps/api/src/billing/billing.service.ts` |
| Plan matrix | `packages/entitlements/src/index.ts` |
| Design tokens | `apps/web/src/app/globals.css` |
