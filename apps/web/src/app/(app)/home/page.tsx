'use client';
import { DateTime } from 'luxon';
import Link from 'next/link';
import { TopBar } from '@/components/shell/TopBar';
import { useGql, useChannels, useAccount, useMe, Q } from '@/lib/hooks';
import { PostCard } from '@/components/publish/PostCard';
import { compact, pct, timeAgo } from '@/lib/format';
import { Avatar } from '@/components/ui/primitives';
import { useComposer } from '@/components/composer/store';

export default function HomePage() {
  const account = useAccount(); const channels = useChannels(); const open = useComposer(s => s.open); const me = useMe();
  const canCompare = !!me.data?.organization?.entitlements?.comparisons;
  const now = DateTime.now(); const from = now.minus({ days: 7 }).toISO(), to = now.toISO(), cf = now.minus({ days: 14 }).toISO(), ct = now.minus({ days: 7 }).toISO();
  const summary = useGql<any>(['insights', 'home', canCompare], Q.insightsSummary, { range: canCompare ? { from, to, compareFrom: cf, compareTo: ct } : { from, to } }, { enabled: !!me.data });
  const next = useGql<any>(['targets', 'home-next'], Q.targets, { filter: { status: ['QUEUED', 'SCHEDULED'] }, first: 3 });
  const comments = useGql<any>(['comments', 'home'], Q.comments, { filter: { unansweredOnly: true }, sort: 'newest', first: 3 });
  const templates = useGql<any>(['templates', 'home'], Q.templates, {});
  const m = (k: string) => summary.data?.insightsSummary?.find((x: any) => x.metric === k);
  const list = channels.data?.channels ?? [];
  const tiles: [string, string, (v: number | null) => string][] = [['Posts', 'posts_published', v => String(v ?? 0)], ['Engagements', 'engagements', v => compact(v)], ['New followers', 'follows', v => compact(v)], ['Impressions', 'impressions', v => compact(v)], ['Engagement rate', 'engagement_rate', v => pct(v)]];
  const streak = Math.max(0, ...list.map(c => c.publishedThisWeek > 0 ? 1 : 0)); // simplified: weeks-with-posts is computed server-side in v2
  return (
    <>
      <TopBar title={`Good ${now.hour < 12 ? 'morning' : now.hour < 18 ? 'afternoon' : 'evening'}${account.data?.name ? `, ${account.data.name.split(' ')[0]}` : ''}`} />
      <main className="content" id="main">
        {!list.length && <div className="card" style={{ marginBottom: 16 }}><h2 style={{ marginTop: 0 }}>Let's get you set up</h2><ol><li><Link href="/channels/connect">Connect a channel</Link></li><li>Create your first post</li><li><Link href="/settings/team">Invite your team</Link></li></ol></div>}
        <h2 style={{ fontSize: 14, color: 'var(--fg-subtle)', textTransform: 'uppercase', letterSpacing: '.04em' }}>This week{canCompare ? ' vs last week' : ''}</h2>
        <div className="tiles">{tiles.map(([label, key, f]) => { const x = m(key); const d = x?.change; return <div key={key} className="tile"><div className="label">{label}</div><div className="value">{f(x?.current ?? null)}</div><div className={`delta ${d == null ? 'flat' : d > 0 ? 'up' : d < 0 ? 'down' : 'flat'}`} aria-label={d == null ? 'no comparison' : `${d > 0 ? 'up' : 'down'} ${Math.abs(Math.round(d * 100))} percent versus last week`}>{d == null ? '—' : `${d > 0 ? '▲' : d < 0 ? '▼' : '•'} ${Math.abs(Math.round(d * 100))}%`}</div></div>; })}<div className="tile"><div className="label">Streak</div><div className="value">{streak ? '🔥' : '—'} {streak}</div><div className="delta flat">weeks posting</div></div></div>
        <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', marginTop: 20 }}>
          <section className="card" aria-labelledby="up-next"><div className="row" style={{ justifyContent: 'space-between' }}><h2 id="up-next" style={{ margin: 0, fontSize: 15 }}>Up next</h2><Link href="/all-channels" className="subtle">View queue</Link></div><div className="stack" style={{ marginTop: 10 }}>{(next.data?.targets.edges ?? []).map((e: any) => <PostCard key={e.node.id} t={e.node} showChannel />)}{next.data && !next.data.targets.edges.length && <p className="subtle">Nothing scheduled. <button className="btn ghost sm" onClick={() => open({})}>Create a post</button></p>}</div></section>
          <section className="card" aria-labelledby="unanswered"><div className="row" style={{ justifyContent: 'space-between' }}><h2 id="unanswered" style={{ margin: 0, fontSize: 15 }}>Unanswered comments {comments.data?.unansweredCount ? `(${comments.data.unansweredCount})` : ''}</h2><Link href="/community" className="subtle">Open Community</Link></div><div className="stack" style={{ marginTop: 10 }}>{(comments.data?.comments.edges ?? []).map((e: any) => <Link key={e.node.id} href={`/community?comment=${e.node.id}`} className="inbox-item" style={{ textDecoration: 'none' }}><Avatar src={e.node.authorAvatarUrl} name={e.node.authorName ?? e.node.authorHandle} network={e.node.channel.network} size="sm" /><div style={{ minWidth: 0 }}><div className="subtle"><b style={{ color: 'var(--fg)' }}>{e.node.authorName ?? e.node.authorHandle}</b> · {timeAgo(e.node.externalCreatedAt)}</div><div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.node.text}</div></div></Link>)}{comments.data && !comments.data.comments.edges.length && <p className="subtle">All caught up 🎉</p>}</div></section>
        </div>
        <section style={{ marginTop: 20 }}><div className="row" style={{ justifyContent: 'space-between' }}><h2 style={{ fontSize: 15, margin: 0 }}>Posting goals</h2><Link href="/channels" className="subtle">Set goals</Link></div><div className="row" style={{ flexWrap: 'wrap', gap: 10, marginTop: 10 }}>{list.filter(c => c.postingGoalPerWeek).map(c => <div key={c.id} className="card row" style={{ padding: 10 }}><span className="ring" style={{ ['--p' as any]: Math.min(100, Math.round((c.publishedThisWeek / c.postingGoalPerWeek) * 100)) }} data-label={`${c.publishedThisWeek}/${c.postingGoalPerWeek}`} aria-label={`${c.displayName}: ${c.publishedThisWeek} of ${c.postingGoalPerWeek} posts this week`} /><div><b style={{ fontSize: 13 }}>{c.displayName}</b><div className="subtle">{c.publishedThisWeek}/{c.postingGoalPerWeek} this week</div></div></div>)}{!list.some(c => c.postingGoalPerWeek) && <p className="subtle">Set a weekly posting goal per channel to track consistency.</p>}</div></section>
        <section style={{ marginTop: 20 }}><h2 style={{ fontSize: 15 }}>Templates for inspiration</h2><div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(220px,1fr))' }}>{(templates.data?.templates ?? []).slice(0, 4).map((t: any) => <button key={t.id} className="card" style={{ textAlign: 'left', cursor: 'pointer' }} onClick={() => open({ prefill: { text: t.body, templateId: t.id } })}><b style={{ fontSize: 13 }}>{t.title}</b><p className="subtle" style={{ margin: '4px 0 0', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{t.body}</p></button>)}</div></section>
      </main>
    </>
  );
}
