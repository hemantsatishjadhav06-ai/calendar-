/**
 * MCP server (Streamable HTTP) for Claude, ChatGPT, Cursor, Raycast, etc.
 * Auth: Authorization: Bearer <relay API key> — forwarded to the public GraphQL API, so quotas and scopes apply unchanged.
 */
import express from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { env } from '@relay/config';
import { publicRulesSummary } from '@relay/network-rules';

async function gql(apiKey: string, query: string, variables?: Record<string, unknown>) {
  const r = await fetch(`${env.API_URL}/graphql`, { method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' }, body: JSON.stringify({ query, variables }) });
  const j: any = await r.json();
  if (j.errors?.length) throw new Error(j.errors.map((e: any) => e.message).join('; '));
  return j.data;
}
const text = (v: unknown) => ({ content: [{ type: 'text' as const, text: typeof v === 'string' ? v : JSON.stringify(v, null, 2) }] });

export function buildServer(apiKey: string) {
  const s = new McpServer({ name: 'relay', version: '1.0.0' });
  s.tool('list_channels', 'List connected social channels (id, network, name, status, timezone).', {}, async () => text(await gql(apiKey, `{ channels { id network displayName handle status timezone } }`)));
  s.tool('list_posts', 'List posts. Filter by status (DRAFT, PENDING_APPROVAL, QUEUED, SCHEDULED, PUBLISHED, FAILED) and channel ids.', { status: z.array(z.string()).optional(), channelIds: z.array(z.string()).optional(), first: z.number().int().min(1).max(100).default(20), after: z.string().optional() }, async a => text(await gql(apiKey, `query($f:PostFilter,$n:Int,$a:String){ targets(filter:$f,first:$n,after:$a){ edges{ node{ id postId status text dueAt publishedAt externalUrl failureCode failureMessage channel{ id displayName network } } } pageInfo{ hasNextPage endCursor } } }`, { f: { status: a.status, channelIds: a.channelIds }, n: a.first, a: a.after })));
  s.tool('create_post', 'Create a post for one or more channels. mode: QUEUE (next slot), SHARE_NEXT, CUSTOM (needs dueAt ISO), NOW, DRAFT. metadata is per-network (e.g. {"postType":"reel"} for Instagram, {"boardId":"…"} for Pinterest, {"privacyLevel":"PUBLIC_TO_EVERYONE"} for TikTok, {"title":"…"} for YouTube).', { channelIds: z.array(z.string()).min(1), text: z.string(), mode: z.enum(['QUEUE', 'SHARE_NEXT', 'CUSTOM', 'NOW', 'DRAFT']).default('QUEUE'), dueAt: z.string().datetime().optional(), firstComment: z.string().optional(), metadata: z.record(z.any()).optional(), tagIds: z.array(z.string()).optional(), requestApproval: z.boolean().optional() },
    async a => text(await gql(apiKey, `mutation($i:CreatePostInput!){ createPost(input:$i){ id status targets{ id channelId status dueAt } } }`, { i: { baseText: a.text, mode: a.mode, dueAt: a.dueAt, tagIds: a.tagIds, requestApproval: a.requestApproval, aiAssisted: true, targets: a.channelIds.map(channelId => ({ channelId, firstComment: a.firstComment, metadata: a.metadata ?? {} })) } })));
  s.tool('validate_post', 'Check a post against each network\'s rules (character limits, media, metadata) without creating it.', { channelIds: z.array(z.string()).min(1), text: z.string(), metadata: z.record(z.any()).optional() }, async a => text(await gql(apiKey, `query($i:CreatePostInput!){ validatePost(input:$i){ channelId issues{ level field message } } }`, { i: { baseText: a.text, mode: 'DRAFT', targets: a.channelIds.map(channelId => ({ channelId, metadata: a.metadata ?? {} })) } })));
  s.tool('edit_post', 'Edit the text of an existing (unpublished) post.', { postId: z.string(), text: z.string() }, async a => text(await gql(apiKey, `mutation($id:ID!,$i:UpdatePostInput!){ updatePost(id:$id,input:$i){ id status } }`, { id: a.postId, i: { baseText: a.text } })));
  s.tool('reschedule_post', 'Move a post target to a specific time (ISO 8601) or back to the next queue slot.', { targetId: z.string(), dueAt: z.string().datetime().optional() }, async a => text(a.dueAt ? await gql(apiKey, `mutation($t:ID!,$d:DateTime!){ setTargetTime(targetId:$t,dueAt:$d) }`, { t: a.targetId, d: a.dueAt }) : await gql(apiKey, `mutation($t:ID!){ moveToNextSlot(targetId:$t) }`, { t: a.targetId })));
  s.tool('delete_post', 'Delete a post (all of its channel targets).', { postId: z.string() }, async a => text(await gql(apiKey, `mutation($id:ID!){ deletePost(id:$id) }`, { id: a.postId })));
  s.tool('list_ideas', 'List saved ideas.', { search: z.string().optional(), first: z.number().int().max(100).default(20) }, async a => text(await gql(apiKey, `query($s:String,$n:Int){ ideas(search:$s,first:$n){ edges{ node{ id title body groupId tags{ name } createdAt } } } }`, { s: a.search, n: a.first })));
  s.tool('create_idea', 'Save an idea for later.', { title: z.string().optional(), body: z.string(), tagIds: z.array(z.string()).optional() }, async a => text(await gql(apiKey, `mutation($i:IdeaInput!){ createIdea(input:$i){ id } }`, { i: { title: a.title, body: a.body, tagIds: a.tagIds, aiGenerated: true } })));
  s.tool('get_insights', 'Summary metrics (posts, reactions, comments, impressions, shares, saves, follows, reach, engagement rate) for a date range, optionally compared with another range.', { channelIds: z.array(z.string()).optional(), from: z.string().datetime(), to: z.string().datetime(), compareFrom: z.string().datetime().optional(), compareTo: z.string().datetime().optional() }, async a => text(await gql(apiKey, `query($r:InsightsRange!){ insightsSummary(range:$r){ metric current previous change } }`, { r: { channelIds: a.channelIds, from: a.from, to: a.to, compareFrom: a.compareFrom, compareTo: a.compareTo } })));
  s.tool('top_posts', 'Best-performing published posts in a range.', { channelIds: z.array(z.string()).optional(), from: z.string().datetime(), to: z.string().datetime(), sortBy: z.enum(['engagements', 'impressions', 'likes', 'comments', 'shares', 'saves', 'video_views', 'link_clicks']).default('engagements'), first: z.number().int().max(50).default(10) }, async a => text(await gql(apiKey, `query($r:InsightsRange!,$s:String,$n:Int){ insightsPosts(range:$r,sortBy:$s,first:$n){ edges{ node{ id text publishedAt externalUrl metrics channel{ displayName network } } } } }`, { r: { channelIds: a.channelIds, from: a.from, to: a.to }, s: a.sortBy, n: a.first })));
  s.tool('list_comments', 'Unanswered comments and mentions from the Community inbox.', { channelIds: z.array(z.string()).optional(), unansweredOnly: z.boolean().default(true), first: z.number().int().max(100).default(20) }, async a => text(await gql(apiKey, `query($f:CommentFilter,$n:Int){ comments(filter:$f,first:$n){ edges{ node{ id text authorName authorHandle kind externalCreatedAt labels channel{ displayName network } postTarget{ text externalUrl } } } } }`, { f: { channelIds: a.channelIds, unansweredOnly: a.unansweredOnly }, n: a.first })));
  s.tool('reply_to_comment', 'Reply to a comment on the network.', { commentId: z.string(), text: z.string() }, async a => text(await gql(apiKey, `mutation($id:ID!,$t:String!){ replyToComment(id:$id,text:$t){ id repliedAt } }`, { id: a.commentId, t: a.text })));
  s.resource('network-rules', 'relay://network-rules', { description: 'Per-network limits (characters, media, threads, quotas) and supported features' }, async () => ({ contents: [{ uri: 'relay://network-rules', mimeType: 'application/json', text: JSON.stringify(publicRulesSummary(), null, 2) }] }));
  return s;
}

const app = express(); app.use(express.json({ limit: '1mb' }));
app.all('/mcp', async (req, res) => {
  const key = req.headers.authorization?.replace(/^Bearer\s+/i, '');
  if (!key) return res.status(401).json({ error: 'Authorization: Bearer <Relay API key> required' });
  const server = buildServer(key);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });   // stateless: one request = one session
  res.on('close', () => { transport.close(); server.close(); });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});
app.get('/healthz', (_q, r) => r.send('ok'));
app.listen(Number(process.env.PORT ?? 4200), () => console.log('mcp listening'));
