'use client';
import { Fragment, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { DateTime } from 'luxon';
import { DndContext, useDraggable, useDroppable, type DragEndEvent } from '@dnd-kit/core';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { TopBar } from '@/components/shell/TopBar';
import { useGql, useChannels, useMutate, useAccount, Q, M } from '@/lib/hooks';
import { useComposer } from '@/components/composer/store';
import { Avatar, Menu, MenuItem } from '@/components/ui/primitives';
import { toast } from '@/components/ui/toast';
import { fmtTime, truncate } from '@/lib/format';

const STATUS_SETS: Record<string, string[] | undefined> = { all: undefined, scheduled: ['QUEUED', 'SCHEDULED'], drafts: ['DRAFT'], sent: ['PUBLISHED'], approval: ['PENDING_APPROVAL'] };

export default function CalendarPage() {
  const { view } = useParams<{ view: string }>(); const router = useRouter();
  const account = useAccount(); const weekStart = account.data?.preferences?.weekStartsOn ?? 1;
  const channels = useChannels(); const open = useComposer(s => s.open);
  const setTime = useMutate(M.setTargetTime, { invalidate: [['targets']] });
  const [anchor, setAnchor] = useState<DateTime>(DateTime.now().startOf('day')); const [chan, setChan] = useState<string[]>([]); const [status, setStatus] = useState('all');
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const isWeek = view !== 'month';
  const start = isWeek ? startOfWeek(anchor, weekStart) : startOfWeek(anchor.startOf('month'), weekStart);
  const end = isWeek ? start.plus({ days: 7 }) : startOfWeek(anchor.endOf('month'), weekStart).plus({ days: 7 });
  const q = useGql<any>(['targets', 'cal', start.toISO(), end.toISO(), chan, status], Q.targets, { filter: { from: start.toISO(), to: end.toISO(), channelIds: chan.length ? chan : undefined, status: STATUS_SETS[status] }, first: 100 });
  const items: any[] = useMemo(() => (q.data?.targets.edges ?? []).map((e: any) => e.node).filter((t: any) => t.dueAt || t.publishedAt), [q.data]);
  const days = Array.from({ length: isWeek ? 7 : end.diff(start, 'days').days }, (_, i) => start.plus({ days: i }));
  const byDay = useMemo(() => { const m = new Map<string, any[]>(); for (const t of items) { const k = DateTime.fromISO(t.publishedAt ?? t.dueAt).setZone(zone).toISODate()!; (m.get(k) ?? m.set(k, []).get(k)!).push(t); } return m; }, [items, zone]);

  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over) return; const t = items.find(x => x.id === e.active.id); if (!t || t.status === 'PUBLISHED') return;
    const [dayIso, hour] = String(e.over.id).split('T');
    const prev = DateTime.fromISO(t.dueAt).setZone(zone);
    const next = DateTime.fromISO(dayIso, { zone }).set({ hour: hour ? Number(hour) : prev.hour, minute: prev.minute });
    if (next < DateTime.now()) return toast('That time is in the past', { tone: 'danger' });
    setTime.mutate({ targetId: t.id, dueAt: next.toUTC().toISO() });
    toast(`Moved to ${next.toFormat('ccc d LLL, HH:mm')}${!t.isCustomTime ? ' — now a custom time' : ''}`, { action: { label: 'Undo', onClick: () => setTime.mutate({ targetId: t.id, dueAt: t.dueAt }) } });
  };

  return (
    <>
      <TopBar title="Calendar" tabs={[{ href: '/calendar/week', label: 'Week' }, { href: '/calendar/month', label: 'Month' }]} actions={<a className="btn ghost sm" href="/all-channels">List</a>} />
      <main className="content" id="main" style={{ maxWidth: 'none' }}>
        <div className="row" style={{ marginBottom: 12, flexWrap: 'wrap' }}>
          <button className="btn secondary icon sm" aria-label="Previous" onClick={() => setAnchor(a => a.minus(isWeek ? { weeks: 1 } : { months: 1 }))}><ChevronLeft size={16} /></button>
          <button className="btn secondary icon sm" aria-label="Next" onClick={() => setAnchor(a => a.plus(isWeek ? { weeks: 1 } : { months: 1 }))}><ChevronRight size={16} /></button>
          <button className="btn ghost sm" onClick={() => setAnchor(DateTime.now().startOf('day'))}>Today</button>
          <h2 style={{ margin: '0 8px', fontSize: 16 }}>{isWeek ? `${start.toFormat('d LLL')} – ${start.plus({ days: 6 }).toFormat('d LLL yyyy')}` : anchor.toFormat('LLLL yyyy')}</h2>
          <Menu trigger={<button className="btn secondary sm">Channels {chan.length ? `(${chan.length})` : ''} ▾</button>}><MenuItem onSelect={() => setChan([])}>All channels</MenuItem>{(channels.data?.channels ?? []).map((c: any) => <MenuItem key={c.id} onSelect={() => setChan(s => (s.includes(c.id) ? s.filter(x => x !== c.id) : [...s, c.id]))}>{chan.includes(c.id) ? '✓ ' : ''}{c.displayName}</MenuItem>)}</Menu>
          <select className="select" style={{ width: 'auto', padding: '5px 10px' }} value={status} onChange={e => setStatus(e.target.value)} aria-label="Status filter"><option value="all">All posts</option><option value="scheduled">Scheduled</option><option value="drafts">Drafts</option><option value="approval">Pending approval</option><option value="sent">Sent</option></select>
          <span className="subtle" style={{ marginLeft: 'auto' }}>Drag a post to reschedule · times in {zone.replace(/_/g, ' ')}</span>
        </div>
        <DndContext onDragEnd={onDragEnd}>
          {isWeek ? (
            <div className="cal-grid" role="grid" aria-label="Week view">
              <div className="hd" />{days.map(d => <div key={d.toISODate()} className={`hd ${d.hasSame(DateTime.now(), 'day') ? 'today' : ''}`} role="columnheader">{d.toFormat('ccc d')}</div>)}
              {Array.from({ length: 24 }, (_, h) => (<Fragment key={h}>
                <div className="hour">{String(h).padStart(2, '0')}:00</div>
                {days.map(d => <Cell key={`${d.toISODate()}T${h}`} id={`${d.toISODate()}T${h}`} onCreate={() => open({ dueAt: d.set({ hour: h, minute: 0 }).toUTC().toISO()!, mode: 'CUSTOM' })}>{(byDay.get(d.toISODate()!) ?? []).filter(t => DateTime.fromISO(t.publishedAt ?? t.dueAt).setZone(zone).hour === h).map(t => <Chip key={t.id} t={t} zone={zone} onOpen={() => open({ postId: t.postId })} />)}</Cell>)}
              </Fragment>))}
            </div>
          ) : (
            <div className="month-grid" role="grid" aria-label="Month view">
              {days.slice(0, 7).map(d => <div key={d.toISODate()} className="hd" style={{ background: 'var(--bg-surface)', padding: 6, fontSize: 12, textAlign: 'center' }} role="columnheader">{d.toFormat('ccc')}</div>)}
              {days.map(d => { const list = byDay.get(d.toISODate()!) ?? []; return (
                <Cell key={d.toISODate()} id={d.toISODate()!} className={`month-cell ${d.month !== anchor.month ? 'other' : ''}`} onCreate={() => open({ dueAt: d.set({ hour: 10 }).toUTC().toISO()!, mode: 'CUSTOM' })}>
                  <div className="d" style={d.hasSame(DateTime.now(), 'day') ? { color: 'var(--green-700)', fontWeight: 700 } : {}}>{d.day}</div>
                  {list.slice(0, 3).map(t => <Chip key={t.id} t={t} zone={zone} onOpen={() => open({ postId: t.postId })} />)}
                  {list.length > 3 && <button className="btn ghost sm" style={{ padding: '0 4px', fontSize: 11 }} onClick={() => { setAnchor(d); router.push('/calendar/week'); }}>+{list.length - 3} more</button>}
                </Cell>); })}
            </div>
          )}
        </DndContext>
      </main>
    </>
  );
}

function startOfWeek(d: DateTime, weekStart: number) { const wd = d.weekday % 7; const diff = (wd - weekStart + 7) % 7; return d.minus({ days: diff }).startOf('day'); }

function Cell({ id, children, onCreate, className = 'cell' }: { id: string; children: React.ReactNode; onCreate: () => void; className?: string }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return <div ref={setNodeRef} className={className} role="gridcell" style={isOver ? { background: 'var(--green-50)' } : undefined} onDoubleClick={onCreate}>{children}</div>;
}
function Chip({ t, zone, onOpen }: { t: any; zone: string; onOpen: () => void }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: t.id, disabled: t.status === 'PUBLISHED' });
  const text = t.customized ? t.text : (t.post?.baseText || t.text);
  return (
    <div ref={setNodeRef} className="cal-chip" data-status={t.status} style={{ transform: transform ? `translate(${transform.x}px,${transform.y}px)` : undefined, opacity: isDragging ? .6 : 1, zIndex: isDragging ? 5 : undefined, position: isDragging ? 'relative' : undefined }} {...attributes} {...listeners} onClick={onOpen} role="button" tabIndex={0} onKeyDown={e => e.key === 'Enter' && onOpen()} aria-label={`${t.channel.displayName} ${fmtTime(t.publishedAt ?? t.dueAt, zone)}: ${truncate(text, 60)}`} title={text}>
      <Avatar src={t.channel.avatarUrl} name={t.channel.displayName} network={t.channel.network} size="sm" /><span>{fmtTime(t.publishedAt ?? t.dueAt, zone)}</span>{t.schedulingType === 'NOTIFICATION' && <span aria-label="Notification">📱</span>}<span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{text}</span>
    </div>
  );
}
