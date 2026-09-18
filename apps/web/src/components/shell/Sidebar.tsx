'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Home, PenSquare, CalendarDays, MessageSquare, BarChart3, Layout, Plus, Search, Settings, CreditCard, Radio, LogOut, ChevronsUpDown, Moon } from 'lucide-react';
import { DndContext, closestCenter, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy, arrayMove } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useChannels, useMutate, M, useGql, Q } from '@/lib/hooks';
import { rest, setCurrentOrgId } from '@/lib/api';
import { Avatar, Menu, MenuItem, MenuSep } from '@/components/ui/primitives';
import { useComposer } from '@/components/composer/store';
import { useQueryClient } from '@tanstack/react-query';

export function Sidebar({ account }: { account: any }) {
  const pathname = usePathname(); const router = useRouter(); const qc = useQueryClient();
  const channels = useChannels();
  const views = useGql<{ savedViews: any[] }>(['savedViews'], Q.savedViews);
  const reorder = useMutate(M.reorderChannels, { invalidate: [['channels']] });
  const switchOrg = useMutate(M.switchOrganization);
  const open = useComposer(s => s.open);
  const unanswered = useGql<{ unansweredCount: number }>(['unanswered'], `query { unansweredCount }`, undefined, { refetchInterval: 60_000 });
  const list = channels.data?.channels ?? [];
  const sorted = [...list].sort((a, b) => (a.status === 'RECONNECT_REQUIRED' ? -1 : 0) - (b.status === 'RECONNECT_REQUIRED' ? -1 : 0));
  const is = (p: string) => (pathname === p || pathname.startsWith(p + '/') ? 'page' : undefined);
  const onDragEnd = (e: DragEndEvent) => { if (!e.over || e.active.id === e.over.id) return; const ids = list.map(c => c.id); const next = arrayMove(ids, ids.indexOf(String(e.active.id)), ids.indexOf(String(e.over.id))); reorder.mutate({ ids: next }); };
  const toggleTheme = () => { const cur = document.documentElement.dataset.theme; const next = cur === 'dark' ? 'light' : 'dark'; document.documentElement.dataset.theme = next; localStorage.setItem('relay.theme', next); };

  return (
    <aside className="sidebar" aria-label="Primary">
      <div className="sidebar-head"><span className="sidebar-logo" aria-hidden>C</span><span>Cadence</span><button className="btn primary sm" style={{ marginLeft: 'auto' }} onClick={() => open({})} aria-label="Create post"><Plus size={14} /> New</button></div>
      <button className="sidebar-search" onClick={() => document.dispatchEvent(new CustomEvent('relay:palette'))}><Search size={14} /> Search or jump to… <span className="kbd" style={{ marginLeft: 'auto' }}>⌘K</span></button>
      <nav aria-label="Products">
        <Link className="nav-item" href="/home" aria-current={is('/home')}><Home size={18} /> Home</Link>
        <Link className="nav-item" href="/create" aria-current={is('/create')}><PenSquare size={18} /> Create</Link>
        <Link className="nav-item" href="/all-channels" aria-current={is('/all-channels') ?? is('/calendar')}><CalendarDays size={18} /> Publish</Link>
        <Link className="nav-item" href="/community" aria-current={is('/community')}><MessageSquare size={18} /> Community {!!unanswered.data?.unansweredCount && <span className="count" aria-label={`${unanswered.data.unansweredCount} unanswered`}>{unanswered.data.unansweredCount}</span>}</Link>
        <Link className="nav-item" href="/insights" aria-current={is('/insights')}><BarChart3 size={18} /> Insights</Link>
        <Link className="nav-item" href="/start-page" aria-current={is('/start-page')}><Layout size={18} /> Start Page</Link>
      </nav>
      {!!views.data?.savedViews?.length && <><div className="sidebar-section">Views</div><nav aria-label="Saved views">{views.data.savedViews.map(v => <Link key={v.id} className="nav-item" href={`/${v.area}?view=${v.id}`} style={{ fontSize: 13, padding: '5px 10px' }}>{v.name}</Link>)}</nav></>}
      <div className="sidebar-section">Channels <Link href="/channels" className="btn ghost sm" aria-label="Manage channels"><Settings size={13} /></Link></div>
      <div className="channel-list">
        <Link className="channel-item" href="/all-channels" aria-current={is('/all-channels')}><Radio size={16} className="muted" /> <span className="name">All channels</span></Link>
        <DndContext collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={sorted.map(c => c.id)} strategy={verticalListSortingStrategy}>
            {sorted.map(c => <ChannelRow key={c.id} c={c} current={pathname.startsWith(`/channels/${c.id}`)} />)}
          </SortableContext>
        </DndContext>
        {channels.data && list.length === 0 && <Link className="channel-item" href="/channels/connect" style={{ color: 'var(--green-700)' }}><Plus size={16} /> Connect a channel</Link>}
        {list.length > 0 && <Link className="channel-item muted" href="/channels/connect"><Plus size={16} /> <span className="name">Connect channel</span></Link>}
      </div>
      <div className="sidebar-foot">
        <Menu align="start" trigger={<button className="channel-item" style={{ width: '100%', border: 0, background: 'none', cursor: 'pointer' }} aria-label="Account menu"><Avatar src={account.avatarUrl} name={account.name ?? account.email} size="sm" /><span className="name" style={{ textAlign: 'left' }}><b style={{ display: 'block', fontSize: 13 }}>{account.organizations?.find((o: any) => o.id === account.currentOrganizationId)?.name ?? 'Workspace'}</b><span className="subtle">{account.email}</span></span><ChevronsUpDown size={14} className="muted" /></button>}>
          {account.organizations?.length > 1 && <>{account.organizations.map((o: any) => <MenuItem key={o.id} onSelect={async () => { await switchOrg.mutateAsync({ organizationId: o.id }); setCurrentOrgId(o.id); qc.clear(); router.push('/home'); }}>{o.id === account.currentOrganizationId ? '✓ ' : ''}{o.name}</MenuItem>)}<MenuSep /></>}
          <MenuItem onSelect={() => router.push('/channels')}><Radio size={14} /> Channels</MenuItem>
          <MenuItem onSelect={() => router.push('/billing')}><CreditCard size={14} /> Plans &amp; billing</MenuItem>
          <MenuItem onSelect={() => router.push('/settings')}><Settings size={14} /> Settings</MenuItem>
          <MenuItem onSelect={toggleTheme}><Moon size={14} /> Toggle theme</MenuItem>
          <MenuSep />
          <MenuItem onSelect={async () => { await rest('/auth/logout', { method: 'POST' }); setCurrentOrgId(null); router.replace('/login'); }}><LogOut size={14} /> Log out</MenuItem>
        </Menu>
      </div>
    </aside>
  );
}

function ChannelRow({ c, current }: { c: any; current: boolean }) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: c.id });
  const goal = c.postingGoalPerWeek ? Math.min(100, Math.round((c.publishedThisWeek / c.postingGoalPerWeek) * 100)) : null;
  return (
    <Link ref={setNodeRef} href={`/channels/${c.id}/queue`} className="channel-item" aria-current={current ? 'page' : undefined} data-status={c.status} style={{ transform: CSS.Transform.toString(transform), transition }} {...attributes} {...listeners}>
      <Avatar src={c.avatarUrl} name={c.displayName} network={c.network} size="sm" />
      <span className="name">{c.displayName}</span>
      {c.status === 'RECONNECT_REQUIRED' ? <span className="tag danger" title={c.statusReason ?? 'Reconnect required'}>!</span> : c.status === 'LOCKED' ? <span className="tag" title="Locked on your plan">🔒</span> : goal != null ? <span className="ring" style={{ ['--p' as any]: goal, width: 22, height: 22 }} data-label="" title={`${c.publishedThisWeek}/${c.postingGoalPerWeek} this week`} /> : <span className="count">{c.queueCount || ''}</span>}
    </Link>
  );
}
