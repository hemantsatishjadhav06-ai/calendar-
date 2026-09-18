# Relay public API

One GraphQL endpoint: `POST https://api.<domain>/graphql`
Auth: `Authorization: Bearer rly_live_…` (Settings → API). Select the organization with `X-Organization-Id: <uuid>` (defaults to the key's organization).
Rate limits: 100 requests / 15 min; plus per-plan quotas — Free 250/day · 3,000/30d, Essentials 250/day · 7,500/30d, Team 500/day · 15,000/30d. Responses carry `RateLimit` headers; 429 includes `Retry-After`.
Pagination: cursor-based (`first`, `after`) everywhere, max 100. IDs are UUIDs. Errors return GraphQL `errors[].extensions.code` in `UNAUTHENTICATED | FORBIDDEN | NOT_FOUND | VALIDATION | ENTITLEMENT | CONFLICT | RATE_LIMITED`.
No webhooks in v1 — poll `targets(filter:{status:[PUBLISHED]})` with your own watermark.

## Examples

```graphql
query { channels { id network displayName handle status timezone } }

mutation {
  createPost(input: {
    baseText: "Launch day! https://example.com/launch"
    mode: QUEUE
    targets: [
      { channelId: "…ig…", metadata: { postType: "post" }, firstComment: "#launch #saas" }
      { channelId: "…li…", metadata: { visibility: "PUBLIC" } }
      { channelId: "…pin…", metadata: { boardId: "1234", title: "Launch", link: "https://example.com/launch" } }
    ]
    tagIds: []
  }) { id status targets { id channelId status dueAt } }
}

query { validatePost(input:{ baseText:"…", mode: DRAFT, targets:[{channelId:"…x…"}] }) { channelId issues { level field message } } }

mutation { setTargetTime(targetId: "…", dueAt: "2026-10-01T09:30:00Z") }
mutation { shareNow(targetId: "…") }

query { insightsSummary(range:{ from:"2026-08-01T00:00:00Z", to:"2026-08-31T23:59:59Z", compareFrom:"2026-07-01T00:00:00Z", compareTo:"2026-07-31T23:59:59Z" }) { metric current previous change } }

query { comments(filter:{ unansweredOnly:true }, first: 20) { edges { node { id text authorHandle channel { displayName } } } } }
mutation { replyToComment(id:"…", text:"Thanks!") { id } }
```

## Per-network `metadata`
| Network | Keys |
|---|---|
| Instagram | `postType` post\|reel\|story, `shareToFeed`, `locationId`, `collaborators[]`, `shopGridLink` |
| Facebook | `postType` post\|reel\|story, `title`, `link` |
| Threads | `topicTag`, `replyControl`, `poll{option_a..d}` |
| X | `poll{options,durationMinutes}`, `replySettings`, `quoteTweetId` |
| LinkedIn | `visibility`, `title`, `document{title}`, `poll{question,options,duration}`, `mentions[{display,urn}]`, `disableReshare` |
| TikTok | `privacyLevel` (required), `disableDuet/Comment/Stitch`, `brandContent`, `brandOrganic`, `aiGenerated`, `photoTitle`, `autoAddMusic` |
| YouTube | `title` (required), `privacyStatus`, `madeForKids`, `categoryId`, `tags[]`, `playlistId`, `publishAt`, `notifySubscribers` |
| Pinterest | `boardId` (required), `boardSectionId`, `title`, `link` |
| Google Business | `topicType` STANDARD\|EVENT\|OFFER, `cta{actionType,url}`, `event{title,start,end}`, `offer{couponCode,redeemOnlineUrl,terms}` |
| Bluesky | `langs[]`, `replyControl`, `selfLabels[]` |
| Mastodon | `visibility`, `spoilerText`, `sensitive`, `language`, `poll{options,expiresInSec,multiple}` |

Threads on X/Threads/Bluesky/Mastodon: pass `thread: [{ text }, …]` on the target (max 25 parts). Media: `media: [{ assetId, kind, altText }]` where assets come from `POST /uploads` (see `apps/api/src/uploads`).

## MCP
`https://mcp.<domain>/mcp` (Streamable HTTP) with the same bearer key. Tools: `list_channels`, `list_posts`, `create_post`, `validate_post`, `edit_post`, `reschedule_post`, `delete_post`, `list_ideas`, `create_idea`, `get_insights`, `top_posts`, `list_comments`, `reply_to_comment`; resource `relay://network-rules`.
