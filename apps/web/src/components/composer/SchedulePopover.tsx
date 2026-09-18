'use client';
import { useEffect, useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { DateTime } from 'luxon';
import { CalendarClock } from 'lucide-react';
import { useChannel } from '@/lib/hooks';
import { fmtDateTime } from '@/lib/format';

/** "Set date and time" with ✨ suggested slots (from the channel's posting schedule) in the channel's timezone. */
export function SchedulePopover({ channels, onPick }: { channels: any[]; onPick: (iso: string) => void }) {
  const [open, setOpen] = useState(false);
  const zone = channels[0]?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const [local, setLocal] = useState(DateTime.now().setZone(zone).plus({ hours: 1 }).startOf('hour').toFormat("yyyy-MM-dd'T'HH:mm"));
  const first = useChannel(channels[0]?.id ?? '', { enabled: !!channels[0]?.id });
  useEffect(() => { const h = () => setOpen(true); document.addEventListener('relay:schedule-popover', h); return () => document.removeEventListener('relay:schedule-popover', h); }, []);
  useEffect(() => { setLocal(DateTime.now().setZone(zone).plus({ hours: 1 }).startOf('hour').toFormat("yyyy-MM-dd'T'HH:mm")); }, [zone]);
  const iso = DateTime.fromFormat(local, "yyyy-MM-dd'T'HH:mm", { zone }).toUTC().toISO();
  const past = iso ? Date.parse(iso) < Date.now() : false;
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild><button className="btn ghost sm" aria-label="Set date and time"><CalendarClock size={14} /></button></Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="popover" sideOffset={8} align="end">
          <h3 style={{ margin: '0 0 8px', fontSize: 14 }}>Set date and time</h3>
          <div className="field"><label htmlFor="when">When <span className="subtle">({zone.replace(/_/g, ' ')})</span></label><input id="when" className="input" type="datetime-local" value={local} onChange={e => setLocal(e.target.value)} />{past && <span className="error">That time is in the past</span>}</div>
          {channels.length > 1 && channels.some(c => c.timezone !== zone) && <p className="hint">Channels in other time zones publish at the same instant: {channels.filter(c => c.timezone !== zone).map(c => `${c.displayName} ${iso ? fmtDateTime(iso, c.timezone) : ''}`).join(' · ')}</p>}
          {!!first.data?.channel?.suggestedSlots?.length && <><div className="subtle" style={{ margin: '8px 0 4px' }}>✨ Suggested posting slots</div><div className="stack" style={{ gap: 4 }}>{first.data.channel.suggestedSlots.slice(0, 5).map((s: string) => <button key={s} className="menu-item" onClick={() => setLocal(DateTime.fromISO(s).setZone(zone).toFormat("yyyy-MM-dd'T'HH:mm"))}>{fmtDateTime(s, zone)}</button>)}</div></>}
          <div className="row" style={{ justifyContent: 'flex-end', marginTop: 10 }}><button className="btn secondary sm" onClick={() => setOpen(false)}>Cancel</button><button className="btn primary sm" disabled={!iso || past} onClick={() => { if (iso) { onPick(iso); setOpen(false); } }}>Schedule</button></div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
