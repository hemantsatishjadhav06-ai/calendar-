# @relay/graphql — schema governance

`schema.public.graphql` is the committed snapshot of the last released public API. CI runs `schema:check`, which regenerates the live schema from `apps/api` and diffs it against the snapshot. Any breaking change (removed field, narrowed type, new required argument) fails the build — exactly Buffer's approach with GraphQL Hive.

Release procedure for an intentional breaking change:
1. Add `@deprecated(reason: "...")` to the old field and ship the new one alongside.
2. Announce in `developers/CHANGELOG.md` with a removal date ≥ 90 days out.
3. After the date, remove the field and refresh the snapshot: `pnpm schema:emit && cp ../../apps/api/schema.graphql schema.public.graphql`.

Public-API clients authenticate with `Authorization: Bearer rly_live_…` (personal API key) and select the organization with `X-Organization-Id`.
