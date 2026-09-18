'use client';
import { useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { DateTime } from 'luxon';
import { DndContext, useDraggable, useDroppable, type DragEndEvent } from '@dnd-kit/core';
import { ChevronLeft, ChevronRight, CalendarPlus, X as XIcon } from 'lucide-react';
import { TopBar } from '@/components/shell/TopBar';
import { useGql, useChannels, useMutate, useAccount, Q, M } from '@/lib/hooks';
import { useComposer } from '@/components/composer/store';
import { Avatar, Menu, MenuItem, Modal } from '@/components/ui/primitives';
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
  const events = useGql<any>(['calendarEvents', start.toISODate(), end.toISODate()], Q.calendarEvents, { from: start.toISODate(), to: end.toISODate() });
  const eventsByDay = useMemo(() => { const m = new Map<string, any[]>(); for (const ev of events.data?.calendarEvents ?? []) { let d = DateTime.fromISO(ev.startDate.slice(0, 10)); const last = DateTime.fromISO(ev.endDate.slice(0, 10)); for (let i = 0; d <= last && i < 366; i++, d = d.plus({ days: 1 })) { const k = d.toISODate()!; (m.get(k) ?? m.set(k, []).get(k)!).push(ev); } } return m; }, [events.data]);
  const createEvent = useMutate(M.createCalendarEvent, { invalidate: [['calendarEvents']], success: 'Event added' });
  const deleteEvent = useMutate(M.deleteCalendarEvent, { invalidate: [['calendarEvents']], success: 'Event removed' });
  const [eventModal, setEventModal] = useState(false); const [ev, setEv] = useState({ title: '', startDate: DateTime.now().toISODate()!, endDate: DateTime.now().toISODate()!, color: '#F79009' });

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
          <button className="btn secondary sm" onClick={() => { setEv({ title: '', startDate: anchor.toISODate()!, endDate: anchor.toISODate()!, color: '#F79009' }); setEventModal(true); }}><CalendarPlus size={13} /> Event</button>
          <span className="subtle" style={{ marginLeft: 'auto' }}>Drag a post to reschedule · times in {zone.replace(/_/g, ' ')}</span>
        </div>
        <DndContext onDragEnd={onDragEnd}>
          {isWeek ? (
            <div className="cal-grid" role="grid" aria-label="Week view">
              {/* role="row" wrappers with display:contents give a valid grid>row>cell ARIA tree without disturbing the CSS grid layout */}
              <div role="row" style={{ display: 'contents' }}>
                <div className="hd" role="columnheader" aria-label="Time" />{days.map(d => <div key={d.toISODate()} className={`hd ${d.hasSame(DateTime.now(), 'day') ? 'today' : ''}`} role="columnheader">{d.toFormat('ccc d')}{(eventsByDay.get(d.toISODate()!) ?? []).map((ev: any) => <EventChip key={ev.id} ev={ev} onDelete={() => confirm(`Remove "${ev.title}"?`) && deleteEvent.mutate({ id: ev.id })} />)}</div>)}
              </div>
              {Array.from({ length: 24 }, (_, h) => (
                <div key={h} role="row" style={{ display: 'contents' }}>
                  <div className="hour" role="rowheader">{String(h).padStart(2, '0')}:00</div>
                  {days.map(d => <Cell key={`${d.toISODate()}T${h}`} id={`${d.toISODate()}T${h}`} onCreate={() => open({ dueAt: d.set({ hour: h, minute: 0 }).toUTC().toISO()!, mode: 'CUSTOM' })}>{(byDay.get(d.toISODate()!) ?? []).filter(t => DateTime.fromISO(t.publishedAt ?? t.dueAt).setZone(zone).hour === h).map(t => <Chip key={t.id} t={t} zone={zone} onOpen={() => open({ postId: t.postId })} />)}</Cell>)}
                </div>
              ))}
            </div>
          ) : (
            <div className="month-grid" role="grid" aria-label="Month view">
              <div role="row" style={{ display: 'contents' }}>{days.slice(0, 7).map(d => <div key={d.toISODate()} className="hd" style={{ background: 'var(--bg-surface)', padding: 6, fontSize: 12, textAlign: 'center' }} role="columnheader">{d.toFormat('ccc')}</div>)}</div>
              {Array.from({ length: Math.ceil(days.length / 7) }, (_, w) => (
                <div key={w} role="row" style={{ display: 'contents' }}>
                  {days.slice(w * 7, w * 7 + 7).map(d => { const list = byDay.get(d.toISODate()!) ?? []; return (
                    <Cell key={d.toISODate()} id={d.toISODate()!} className={`month-cell ${d.month !== anchor.month ? 'other' : ''}`} onCreate={() => open({ dueAt: d.set({ hour: 10 }).toUTC().toISO()!, mode: 'CUSTOM' })}>
                      <div className="d" style={d.hasSame(DateTime.now(), 'day') ? { color: 'var(--green-700)', fontWeight: 700 } : {}}>{d.day}</div>
                      {(eventsByDay.get(d.toISODate()!) ?? []).map((ev: any) => <EventChip key={ev.id} ev={ev} onDelete={() => confirm(`Remove "${ev.title}"?`) && deleteEvent.mutate({ id: ev.id })} />)}
                      {list.slice(0, 3).map(t => <Chip key={t.id} t={t} zone={zone} onOpen={() => open({ postId: t.postId })} />)}
                      {list.length > 3 && <button className="btn ghost sm" style={{ padding: '0 4px', fontSize: 11 }} onClick={() => { setAnchor(d); router.push('/calendar/week'); }}>+{list.length - 3} more</button>}
                    </Cell>); })}
                </div>
              ))}
            </div>
          )}
        </DndContext>
      </main>
      {eventModal && (
        <Modal open onOpenChange={o => !o && setEventModal(false)} title="Add calendar event" size="sm" footer={<><span style={{ flex: 1 }} /><button className="btn secondary" onClick={() => setEventModal(false)}>Cancel</button><button className="btn primary" disabled={!ev.title.trim() || createEvent.isPending} onClick={() => { createEvent.mutate({ title: ev.title, startDate: ev.startDate, endDate: ev.endDate < ev.startDate ? ev.startDate : ev.endDate, color: ev.color }); setEventModal(false); }}>Add event</button></>}>
          <div className="field"><label htmlFor="ev-title">Title</label><input id="ev-title" className="input" placeholder="Black Friday campaign" value={ev.title} onChange={e => setEv(s => ({ ...s, title: e.target.value }))} /></div>
          <div className="row" style={{ gap: 12 }}>
            <div className="field" style={{ flex: 1 }}><label htmlFor="ev-start">Start</label><input id="ev-start" className="input" type="date" value={ev.startDate} onChange={e => setEv(s => ({ ...s, startDate: e.target.value, endDate: s.endDate < e.target.value ? e.target.value : s.endDate }))} /></div>
            <div className="field" style={{ flex: 1 }}><label htmlFor="ev-end">End</label><input id="ev-end" className="input" type="date" min={ev.startDate} value={ev.endDate} onChange={e => setEv(s => ({ ...s, endDate: e.target.value }))} /></div>
          </div>
          <div className="field" role="group" aria-label="Colour"><span style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 600 }}>Colour</span><div className="row" style={{ gap: 8 }}>{['#F79009', '#D92D20', '#2C4BFF', '#7C3AED', '#0E9384', '#4E9A33'].map(c => <button key={c} type="button" aria-label={`Colour ${c}`} aria-pressed={ev.color === c} onClick={() => setEv(s => ({ ...s, color: c }))} style={{ width: 26, height: 26, borderRadius: 6, background: c, border: ev.color === c ? '2px solid var(--fg)' : '2px solid transparent', cursor: 'pointer' }} />)}</div></div>
        </Modal>
      )}
    </>
  );
}

function EventChip({ ev, onDelete }: { ev: any; onDelete: () => void }) {
  return (
    <div className="cal-event" style={{ ['--ev' as any]: ev.color }} title={ev.note || ev.title}>
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ev.title}</span>
      <button className="cal-event-x" aria-label={`Remove ${ev.title}`} onClick={e => { e.stopPropagation(); onDelete(); }}><XIcon size={11} /></button>
    </div>
  );
}

function startOfWeek(d: DateTime, weekStart: number) { const wd = d.weekday % 7; const diff = (wd - weekStart + 7) % 7; return d.minus({ days: diff }).startOf('day'); }

function Cell({ id, children, onCreate, className = 'cell' }: { id: string; children: React.ReactNode; onCreate: () => void; className?: string }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return <div ref={setNodeRef} className={className} role="gridcell" tabIndex={0} style={isOver ? { background: 'var(--green-50)' } : undefined} onDoubleClick={onCreate}>{children}</div>;
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
