'use client';
import { useMemo, useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { DndContext, closestCenter, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { DateTime } from 'luxon';
import { CalendarPlus } from 'lucide-react';
import { gqlRequest } from '@/lib/api';
import { Q, M } from '@/lib/queries';
import { useMutate } from '@/lib/hooks';
import { PostCard } from './PostCard';
import { EmptyState } from '@/components/ui/primitives';
import { useComposer } from '@/components/composer/store';
import { dayKey, relDay, fmtDate, fmtTime } from '@/lib/format';

type Tab = 'queue' | 'drafts' | 'approvals' | 'sent';
const STATUS: Record<Tab, string[]> = { queue: ['QUEUED', 'SCHEDULED', 'PUBLISHING', 'NOTIFIED', 'FAILED'], drafts: ['DRAFT'], approvals: ['PENDING_APPROVAL'], sent: ['PUBLISHED', 'PARTIALLY_PUBLISHED'] };

export function QueueList({ tab, channel, channelIds, zone, showSlots, canPublish = true, canApprove = false, tagIds, search }: { tab: Tab; channel?: any; channelIds?: string[]; zone: string; showSlots?: boolean; canPublish?: boolean; canApprove?: boolean; tagIds?: string[]; search?: string }) {
  const open = useComposer(s => s.open);
  const swap = useMutate(M.swapTargets, { invalidate: [['targets']] });
  const filter = { status: STATUS[tab], channelIds: channel ? [channel.id] : channelIds, tagIds: tagIds?.length ? tagIds : undefined, search: search || undefined };
  const q = useInfiniteQuery({ queryKey: ['targets', tab, channel?.id ?? channelIds?.join(',') ?? 'all', tagIds, search], queryFn: ({ pageParam }) => gqlRequest(tab === 'sent' ? Q.targetsWithMetrics : Q.targets, { filter, first: 50, after: pageParam }), initialPageParam: undefined as string | undefined, getNextPageParam: (last: any) => (last.targets.pageInfo.hasNextPage ? last.targets.pageInfo.endCursor : undefined), staleTime: 10_000 });
  const items: any[] = useMemo(() => (q.data?.pages ?? []).flatMap((p: any) => p.targets.edges.map((e: any) => e.node)), [q.data]);
  const [dragIds, setDragIds] = useState<string[] | null>(null);

  // Group by day (channel tz for a single channel, browser tz for All channels — Buffer parity)
  const groups = useMemo(() => {
    const m = new Map<string, any[]>();
    for (const t of items) { const key = t.dueAt || t.publishedAt ? dayKey(t.publishedAt ?? t.dueAt, zone) : 'unscheduled'; (m.get(key) ?? m.set(key, []).get(key)!).push(t); }
    return Array.from(m.entries());
  }, [items, zone]);

  // Empty posting slots (single channel, queue tab): next 14 days of schedule minus taken instants
  const emptySlots = useMemo(() => {
    if (!showSlots || !channel?.scheduleByDay || tab !== 'queue') return new Map<string, string[]>();
    const taken = new Set(items.filter(t => t.dueAt).map(t => new Date(t.dueAt).getTime()));
    const out = new Map<string, string[]>();
    let d = DateTime.now().setZone(zone).startOf('day');
    for (let i = 0; i < 14; i++, d = d.plus({ days: 1 })) {
      for (const hm of channel.scheduleByDay[d.weekday % 7] ?? []) { const [h, mi] = hm.split(':').map(Number); const at = d.set({ hour: h, minute: mi }); if (at < DateTime.now() || taken.has(at.toMillis())) continue; (out.get(d.toISODate()!) ?? out.set(d.toISODate()!, []).get(d.toISODate()!)!).push(at.toUTC().toISO()!); }
    }
    return out;
  }, [showSlots, channel, items, zone, tab]);
  const allDays = useMemo(() => { const s = new Set<string>([...groups.map(g => g[0]), ...emptySlots.keys()]); return Array.from(s).sort((a, b) => (a === 'unscheduled' ? 1 : b === 'unscheduled' ? -1 : a.localeCompare(b) * (tab === 'sent' ? -1 : 1))); }, [groups, emptySlots, tab]);

  const onDragEnd = (e: DragEndEvent) => { setDragIds(null); if (!e.over || e.active.id === e.over.id) return; swap.mutate({ aId: String(e.active.id), bId: String(e.over.id) }); };

  if (q.isLoading) return <div className="stack">{[1, 2, 3].map(i => <div key={i} className="skeleton" style={{ height: 96 }} />)}</div>;
  if (!items.length && !emptySlots.size) return <EmptyState icon={<CalendarPlus size={36} className="muted" />} title={tab === 'queue' ? 'Your queue is empty' : tab === 'drafts' ? 'No drafts' : tab === 'approvals' ? 'Nothing awaiting approval' : 'Nothing published yet'} body={tab === 'queue' ? 'Add posts and they will publish at your next posting slots.' : tab === 'sent' ? 'Published posts appear here with their performance.' : undefined} action={tab !== 'sent' && canPublish ? <button className="btn primary" onClick={() => open({ channelIds: channel ? [channel.id] : undefined })}>Create a post</button> : undefined} />;

  const sortableIds = items.filter(t => t.status === 'QUEUED' && !t.isCustomTime).map(t => t.id);
  return (
    <DndContext collisionDetection={closestCenter} onDragStart={() => setDragIds(sortableIds)} onDragEnd={onDragEnd} onDragCancel={() => setDragIds(null)}>
      <SortableContext items={sortableIds} strategy={verticalListSortingStrategy}>
        {allDays.map(day => {
          const posts = groups.find(g => g[0] === day)?.[1] ?? [];
          const slots = emptySlots.get(day) ?? [];
          const rows = [...posts.map(p => ({ kind: 'post' as const, at: p.publishedAt ?? p.dueAt, p })), ...slots.map(s => ({ kind: 'slot' as const, at: s }))].sort((a, b) => (a.at && b.at ? (new Date(a.at).getTime() - new Date(b.at).getTime()) * (tab === 'sent' ? -1 : 1) : 0));
          return (
            <section key={day} aria-labelledby={`day-${day}`}>
              <h2 className="day-head" id={`day-${day}`} style={{ fontSize: 15 }}>{day === 'unscheduled' ? 'Not scheduled' : <>{relDay(day, zone)} <span className="subtle">· {fmtDate(day, zone)}</span></>}<span className="tz">{zone.replace(/_/g, ' ')}</span></h2>
              {rows.map((r, i) => r.kind === 'post' ? (
                <div className="slot" key={r.p.id}><div className="slot-time" aria-hidden>{r.at ? fmtTime(r.at, zone) : ''}</div><PostCard t={r.p} zone={zone} showChannel={!channel} sortable={!!channel && canPublish && tab === 'queue'} canPublish={canPublish} canApprove={canApprove} /></div>
              ) : (
                <div className="slot" key={`slot-${i}`}><div className="slot-time" aria-hidden>{fmtTime(r.at, zone)}</div><button className="slot-empty" onClick={() => open({ channelIds: [channel.id], dueAt: r.at, mode: 'CUSTOM' })}>+ Add a post for this slot</button></div>
              ))}
            </section>
          );
        })}
      </SortableContext>
      {q.hasNextPage && <div style={{ textAlign: 'center', marginTop: 16 }}><button className="btn secondary" onClick={() => q.fetchNextPage()} disabled={q.isFetchingNextPage}>{q.isFetchingNextPage ? 'Loading…' : 'Load more'}</button></div>}
      {dragIds && <div className="sr-only" aria-live="assertive">Dragging. Drop on another post to swap positions.</div>}
    </DndContext>
  );
}
