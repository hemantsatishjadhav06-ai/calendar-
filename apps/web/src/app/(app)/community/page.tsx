'use client';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useInfiniteQuery } from '@tanstack/react-query';
import { RefreshCw, Check, EyeOff, Trash2, Heart, Sparkles, MessageSquareText } from 'lucide-react';
import { TopBar } from '@/components/shell/TopBar';
import { gqlRequest, rest } from '@/lib/api';
import { Q, M } from '@/lib/queries';
import { useChannels, useGql, useMe, useMutate } from '@/lib/hooks';
import { Avatar, Menu, MenuItem, EmptyState, UpgradeHint } from '@/components/ui/primitives';
import { toast } from '@/components/ui/toast';
import { timeAgo, NETWORK_LABEL, compact } from '@/lib/format';

type View = 'post' | 'list' | 'grid';
export default function CommunityPage() { return <Suspense fallback={null}><CommunityInner /></Suspense>; }

function CommunityInner() {
  const params = useSearchParams(); const tab = params.get('tab') === 'mentions' ? 'mentions' : 'comments';
  const channels = useChannels(); const me = useMe(); const ent = me.data?.organization?.entitlements ?? {};
  const [view, setView] = useState<View>('post'); const [sort, setSort] = useState('unanswered'); const [chan, setChan] = useState<string[]>([]); const [showResolved, setShowResolved] = useState(false); const [selectedPost, setSelectedPost] = useState<{ channelId: string; externalPostId: string } | null>(null); const [focus, setFocus] = useState<string | null>(params.get('comment'));
  const filter = useMemo(() => ({ channelIds: chan.length ? chan : undefined, includeResolved: showResolved, kinds: tab === 'mentions' ? ['MENTION'] : ['COMMENT', 'REPLY', 'REVIEW', 'DM'], ...(view === 'post' && selectedPost ? { postExternalId: selectedPost.externalPostId, channelIds: [selectedPost.channelId] } : {}) }), [chan, showResolved, tab, view, selectedPost]);
  const q = useInfiniteQuery({ queryKey: ['comments', filter, sort], queryFn: ({ pageParam }) => gqlRequest(Q.comments, { filter, sort, first: 50, after: pageParam }), initialPageParam: undefined as string | undefined, getNextPageParam: (l: any) => (l.comments.pageInfo.hasNextPage ? l.comments.pageInfo.endCursor : undefined), refetchInterval: 60_000 });
  const groups = useGql<any>(['comments', 'groups', chan, showResolved, tab], Q.commentGroups, { filter: { channelIds: chan.length ? chan : undefined, includeResolved: showResolved, kinds: tab === 'mentions' ? ['MENTION'] : undefined } }, { enabled: view === 'post' });
  const items: any[] = (q.data?.pages ?? []).flatMap((p: any) => p.comments.edges.map((e: any) => e.node));
  const inv = { invalidate: [['comments'], ['unanswered']] };
  const resolve = useMutate(M.resolveComments, { ...inv }); const sync = useMutate(M.syncInbox, { ...inv, success: 'Syncing comments…' });
  useEffect(() => { if (view === 'post' && !selectedPost && groups.data?.commentPostGroups?.[0]) setSelectedPost({ channelId: groups.data.commentPostGroups[0].channelId, externalPostId: groups.data.commentPostGroups[0].externalPostId }); }, [groups.data, view, selectedPost]);
  // Keyboard: ↑/↓ between unanswered, E resolve, R reply
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { const t = e.target as HTMLElement; if (['INPUT', 'TEXTAREA'].includes(t.tagName)) return; const un = items.filter(i => !i.repliedAt); const idx = un.findIndex(i => i.id === focus); if (e.key === 'ArrowDown') { e.preventDefault(); setFocus(un[Math.min(un.length - 1, idx + 1)]?.id ?? null); } if (e.key === 'ArrowUp') { e.preventDefault(); setFocus(un[Math.max(0, idx - 1)]?.id ?? null); } if (e.key.toLowerCase() === 'e' && focus) resolve.mutate({ ids: [focus] }); if (e.key.toLowerCase() === 'r' && focus) document.getElementById(`reply-${focus}`)?.focus(); };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, [items, focus, resolve]);
  useEffect(() => { if (focus) document.getElementById(`c-${focus}`)?.scrollIntoView({ block: 'nearest' }); }, [focus]);
  const unanswered = q.data?.pages?.[0]?.unansweredCount ?? 0;
  return (
    <>
      <TopBar title="Community" tabs={[{ href: '/community', label: 'Comments', count: unanswered }, { href: '/community?tab=mentions', label: 'Mentions' }]} actions={<button className="btn ghost sm" onClick={() => sync.mutate({})}><RefreshCw size={13} /> Sync</button>} />
      <main className="content" id="main" style={{ maxWidth: 'none' }}>
        <div className="row" style={{ flexWrap: 'wrap', marginBottom: 12 }} role="toolbar" aria-label="Inbox filters">
          <Menu trigger={<button className="btn secondary sm">Channels {chan.length ? `(${chan.length})` : ''} ▾</button>}><MenuItem onSelect={() => setChan([])}>All channels</MenuItem>{(channels.data?.channels ?? []).map((c: any) => <MenuItem key={c.id} onSelect={() => setChan(s => (s.includes(c.id) ? s.filter(x => x !== c.id) : [...s, c.id]))}>{chan.includes(c.id) ? '✓ ' : ''}{c.displayName}</MenuItem>)}</Menu>
          <div className="tabs" role="radiogroup" aria-label="View">{(['post', 'list', 'grid'] as View[]).map(v => <button key={v} role="radio" aria-checked={view === v} className="tab" style={{ border: 0, cursor: 'pointer', background: view === v ? 'var(--bg-inset)' : 'none' }} onClick={() => { setView(v); setSelectedPost(null); }}>{{ post: 'By post', list: 'List', grid: 'Grid' }[v]}</button>)}</div>
          <select className="select" style={{ width: 'auto', padding: '5px 10px' }} value={sort} onChange={e => setSort(e.target.value)} aria-label="Sort"><option value="unanswered">Unanswered first</option><option value="newest">Newest</option><option value="oldest">Oldest</option></select>
          <label className="row subtle"><input type="checkbox" checked={showResolved} onChange={e => setShowResolved(e.target.checked)} /> Show resolved</label>
          <span style={{ flex: 1 }} />
          <Menu trigger={<button className="btn secondary sm"><Check size={13} /> Bulk resolve ▾</button>}><MenuItem onSelect={() => resolve.mutate({ all: true })}>Resolve all</MenuItem><MenuItem onSelect={() => resolve.mutate({ olderThanDays: 30 })}>Resolve older than a month</MenuItem>{selectedPost && <MenuItem onSelect={() => resolve.mutate({ postExternalId: selectedPost.externalPostId, channelId: selectedPost.channelId })}>Resolve for this post</MenuItem>}</Menu>
        </div>
        <div className={view === 'post' ? 'inbox' : ''}>
          {view === 'post' && <div className="inbox-list" role="listbox" aria-label="Posts with comments">{(groups.data?.commentPostGroups ?? []).map((g: any) => <button key={`${g.channelId}:${g.externalPostId}`} className="inbox-item" role="option" aria-selected={selectedPost?.externalPostId === g.externalPostId} onClick={() => setSelectedPost({ channelId: g.channelId, externalPostId: g.externalPostId })}>{g.postTarget && <Avatar src={g.postTarget.channel.avatarUrl} name={g.postTarget.channel.displayName} network={g.postTarget.channel.network} size="sm" />}<div style={{ minWidth: 0, flex: 1 }}><div style={{ fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{g.postTarget?.text || `Post ${g.externalPostId.slice(-6)}`}</div><div className="subtle">{g.unanswered ? <b style={{ color: 'var(--fg)' }}>{g.unanswered} unanswered</b> : 'All answered'} · {g.count} total · {timeAgo(g.latestAt)}</div></div></button>)}{groups.data && !groups.data.commentPostGroups.length && <p className="subtle">No comments yet.</p>}</div>}
          <section aria-label="Comments" className={view === 'grid' ? 'grid' : 'stack'} style={view === 'grid' ? { gridTemplateColumns: 'repeat(auto-fill,minmax(240px,1fr))' } : undefined}>
            {q.isLoading && [1, 2, 3].map(i => <div key={i} className="skeleton" style={{ height: 90 }} />)}
            {!q.isLoading && !items.length && <EmptyState icon={<MessageSquareText size={36} className="muted" />} title={tab === 'mentions' ? 'No mentions yet' : 'No comments to show'} body="Comments from Facebook, Instagram, Threads, X, LinkedIn, YouTube, Bluesky, Mastodon, TikTok (Business) and Google reviews appear here within minutes." />}
            {items.map(c => <CommentCard key={c.id} c={c} focused={focus === c.id} onFocus={() => setFocus(c.id)} ent={ent} grid={view === 'grid'} />)}
            {q.hasNextPage && <button className="btn secondary" onClick={() => q.fetchNextPage()}>Load more</button>}
          </section>
          {view === 'post' && <aside className="right" aria-label="Post details">{(() => { const g = groups.data?.commentPostGroups?.find((x: any) => x.externalPostId === selectedPost?.externalPostId); const pt = g?.postTarget; return pt ? <div className="card"><div className="row" style={{ marginBottom: 8 }}><Avatar src={pt.channel.avatarUrl} name={pt.channel.displayName} network={pt.channel.network} size="sm" /><b style={{ fontSize: 13 }}>{pt.channel.displayName}</b></div>{pt.media?.[0]?.thumbUrl && <img src={pt.media[0].thumbUrl} alt="" style={{ width: '100%', borderRadius: 8, marginBottom: 8 }} />}<p style={{ fontSize: 13, whiteSpace: 'pre-wrap' }}>{pt.text}</p>{pt.metrics && <div className="metrics">{pt.metrics.impressions != null && <span>👁 {compact(pt.metrics.impressions)}</span>}<span>♥ {compact(pt.metrics.likes ?? 0)}</span><span>💬 {compact(pt.metrics.comments ?? 0)}</span></div>}{pt.externalUrl && <a className="btn ghost sm" href={pt.externalUrl} target="_blank" rel="noreferrer" style={{ marginTop: 8 }}>View on {NETWORK_LABEL[pt.channel.network]} ↗</a>}</div> : <div className="card subtle">Select a post to see its details.</div>; })()}</aside>}
        </div>
      </main>
    </>
  );
}

function CommentCard({ c, focused, onFocus, ent, grid }: { c: any; focused: boolean; onFocus: () => void; ent: any; grid: boolean }) {
  const [reply, setReply] = useState(''); const [suggesting, setSuggesting] = useState(false);
  const inv = { invalidate: [['comments'], ['unanswered']] };
  const send = useMutate(M.replyToComment, { ...inv, success: 'Reply sent', onSuccess: () => setReply('') }); const like = useMutate(M.likeComment, { success: 'Liked' }); const hide = useMutate(M.hideComment, inv); const del = useMutate(M.deleteComment, { ...inv, success: 'Comment deleted' }); const resolve = useMutate(M.resolveComments, inv);
  const saved = useGql<any>(['savedReplies'], Q.savedReplies);
  const cap = c.capabilities ?? {}; const answered = !!c.repliedAt || !!c.resolvedAt;
  const suggest = async () => { setSuggesting(true); try { const r = await rest('/ai/suggest-reply', { method: 'POST', json: { commentId: c.id } }); setReply(r.text); } catch (e: any) { toast(e.message, { tone: 'danger', extensions: e }); } finally { setSuggesting(false); } };
  const media = c.postTarget?.media?.[0];
  return (
    // Focusable comment card: tabIndex lets keyboard users move between comments and act on the
    // focused one (reply/like/hide are real buttons inside). Clicking a focusable element already
    // fires onFocus, so no click handler is needed.
    // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex, jsx-a11y/no-noninteractive-element-interactions
    <article id={`c-${c.id}`} className="comment" data-answered={answered} tabIndex={0} onFocus={onFocus} style={focused ? { outline: '2px solid var(--focus)' } : undefined} aria-label={`${c.kind.toLowerCase()} from ${c.authorName ?? c.authorHandle ?? 'someone'} on ${NETWORK_LABEL[c.channel.network]}: ${c.text.slice(0, 60)}`}>
      <Avatar src={c.authorAvatarUrl} name={c.authorName ?? c.authorHandle} network={c.channel.network} />
      <div style={{ minWidth: 0 }}>
        {grid && media?.thumbUrl && <img src={media.thumbUrl} alt="" style={{ width: '100%', borderRadius: 8, marginBottom: 6, maxHeight: 160, objectFit: 'cover' }} />}
        <div className="who"><b>{c.authorName ?? c.authorHandle ?? 'Unknown'}</b>{c.authorHandle && c.authorName && <span className="subtle">{c.authorHandle}</span>}<span className="subtle">· {timeAgo(c.externalCreatedAt)} · {c.channel.displayName}</span>{c.kind === 'MENTION' && <span className="tag info">Mention</span>}{c.kind === 'REVIEW' && <span className="tag warn">Review</span>}{c.kind === 'DM' && <span className="tag">DM</span>}{c.triage === 'needs_review' && <span className="tag danger">Needs review</span>}{c.labels?.filter((l: string) => l !== 'negative').slice(0, 2).map((l: string) => <span key={l} className="tag">{l.replace('_', ' ')}</span>)}{c.isHidden && <span className="tag">Hidden</span>}</div>
        <p className="body">{c.text}</p>
        {c.replies?.length > 0 && <div style={{ borderLeft: '2px solid var(--border)', paddingLeft: 10, marginBottom: 8 }}>{c.replies.map((r: any) => <p key={r.id} className="subtle" style={{ margin: '2px 0' }}><b>{r.isOurs ? 'You' : r.authorName}</b>: {r.text}</p>)}</div>}
        <div className="ops">
          {cap.like && <button className="btn ghost sm" onClick={() => like.mutate({ id: c.id })} aria-label="Like"><Heart size={13} /> {c.likeCount || ''}</button>}
          {cap.hide && <button className="btn ghost sm" onClick={() => hide.mutate({ id: c.id, hidden: !c.isHidden })}><EyeOff size={13} /> {c.isHidden ? 'Unhide' : 'Hide'}</button>}
          {cap.delete && <button className="btn ghost sm" onClick={() => confirm('Delete this comment on the network?') && del.mutate({ id: c.id })}><Trash2 size={13} /> Delete</button>}
          <button className="btn ghost sm" onClick={() => resolve.mutate({ ids: [c.id], resolved: !c.resolvedAt })}><Check size={13} /> {c.resolvedAt ? 'Unresolve' : 'Resolve'}</button>
          {c.postTarget?.externalUrl && <a className="btn ghost sm" href={c.postTarget.externalUrl} target="_blank" rel="noreferrer">Open post ↗</a>}
          <button className="btn ghost sm" onClick={() => { navigator.clipboard.writeText(`${location.origin}/community?comment=${c.id}`); toast('Link copied'); }}>Copy link</button>
        </div>
        {cap.reply && !c.isOurs && (
          <div className="reply-box">
            <textarea id={`reply-${c.id}`} className="textarea" placeholder={c.kind === 'REVIEW' ? 'Reply to this review…' : 'Reply…'} value={reply} onChange={e => setReply(e.target.value)} aria-label="Reply" onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && reply.trim()) { e.preventDefault(); send.mutate({ id: c.id, text: reply }); } }} />
            <div className="stack" style={{ gap: 4 }}>
              <button className="btn primary sm" disabled={!reply.trim() || send.isPending} onClick={() => send.mutate({ id: c.id, text: reply })}>Send</button>
              <button className="btn secondary sm" disabled={suggesting} onClick={suggest} title="AI reply suggestion"><Sparkles size={13} /> {suggesting ? '…' : 'Suggest'}</button>
              <Menu trigger={<button className="btn ghost sm">Saved ▾</button>}>{(saved.data?.savedReplies ?? []).map((s: any) => <MenuItem key={s.id} onSelect={() => setReply(s.body)}>{s.title}</MenuItem>)}{!saved.data?.savedReplies?.length && <MenuItem onSelect={() => (window.location.href = '/settings/saved-replies')}>Create saved replies {ent.savedReplies === 1 && <UpgradeHint feature="Saved replies" />}</MenuItem>}</Menu>
            </div>
          </div>
        )}
      </div>
    </article>
  );
}
