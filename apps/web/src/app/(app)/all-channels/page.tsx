'use client';
import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { TopBar } from '@/components/shell/TopBar';
import { QueueList } from '@/components/publish/QueueList';
import { useChannels, useGql, useMe, useMutate, useTags, Q, M } from '@/lib/hooks';
import { Avatar, Menu, MenuItem } from '@/components/ui/primitives';

export default function AllChannelsPage() { return <Suspense fallback={null}><AllChannelsInner /></Suspense>; }

function AllChannelsInner() {
  const params = useSearchParams(); const tab = (params.get('tab') as any) ?? 'queue';
  const channels = useChannels(); const groups = useGql<any>(['channelGroups'], Q.channelGroups); const tags = useTags(); const me = useMe();
  const views = useGql<any>(['savedViews', 'all-channels'], Q.savedViews, { area: 'all-channels' });
  const saveView = useMutate(M.saveView, { invalidate: [['savedViews']], success: 'View saved' });
  const [sel, setSel] = useState<string[]>([]); const [tagIds, setTagIds] = useState<string[]>([]); const [search, setSearch] = useState('');
  const list = channels.data?.channels ?? [];
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const ent = me.data?.organization?.entitlements ?? {};
  const viewId = params.get('view'); const view = views.data?.savedViews?.find((v: any) => v.id === viewId);
  const effSel = sel.length ? sel : view?.filters?.channelIds ?? [];
  const tabs = [{ href: '/all-channels?tab=queue', label: 'Queue' }, { href: '/all-channels?tab=drafts', label: 'Drafts' }, ...(ent.approvals ? [{ href: '/all-channels?tab=approvals', label: 'Approvals' }] : []), { href: '/all-channels?tab=sent', label: 'Sent' }];
  return (
    <>
      <TopBar title={view ? view.name : 'All channels'} tabs={tabs} actions={<Link className="btn ghost sm" href="/calendar/week">Calendar</Link>} />
      <main className="content" id="main">
        <div className="row" style={{ flexWrap: 'wrap', marginBottom: 14, gap: 6 }} role="toolbar" aria-label="Filters">
          <button className={`btn sm ${!effSel.length ? 'primary' : 'secondary'}`} onClick={() => setSel([])}>All</button>
          {list.map(c => <button key={c.id} className={`btn sm ${effSel.includes(c.id) ? 'primary' : 'secondary'}`} aria-pressed={effSel.includes(c.id)} onClick={() => setSel(s => (s.includes(c.id) ? s.filter(x => x !== c.id) : [...s, c.id]))}><Avatar src={c.avatarUrl} name={c.displayName} network={c.network} size="sm" /> {c.displayName}</button>)}
          {!!groups.data?.organization?.channelGroups?.length && <Menu trigger={<button className="btn secondary sm">Groups ▾</button>}>{groups.data.organization.channelGroups.map((g: any) => <MenuItem key={g.id} onSelect={() => setSel(g.channelIds)}>{g.name}</MenuItem>)}</Menu>}
          {!!tags.data?.tags?.length && <Menu trigger={<button className="btn secondary sm">Tags {tagIds.length ? `(${tagIds.length})` : ''} ▾</button>}>{tags.data.tags.map((t: any) => <MenuItem key={t.id} onSelect={() => setTagIds(x => (x.includes(t.id) ? x.filter(i => i !== t.id) : [...x, t.id]))}>{tagIds.includes(t.id) ? '✓ ' : ''}{t.name}</MenuItem>)}</Menu>}
          <input className="input" style={{ width: 200, padding: '5px 10px' }} placeholder="Search posts" value={search} onChange={e => setSearch(e.target.value)} aria-label="Search posts" />
          <span style={{ flex: 1 }} />
          {(effSel.length || tagIds.length) > 0 && <button className="btn ghost sm" onClick={() => { const name = prompt('Name this view'); if (name) saveView.mutate({ area: 'all-channels', name, filters: { channelIds: effSel, tagIds } }); }}>Save view</button>}
          <span className="subtle">Times in {zone.replace(/_/g, ' ')}</span>
        </div>
        <QueueList tab={tab} channelIds={effSel.length ? effSel : undefined} zone={zone} canPublish canApprove tagIds={tagIds} search={search} />
      </main>
    </>
  );
}
