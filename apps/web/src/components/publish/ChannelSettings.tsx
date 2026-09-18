'use client';
import { useState } from 'react';
import { useMutate, M, useMe } from '@/lib/hooks';
import { tzList } from '@/lib/format';
import { Confirm, UpgradeHint } from '@/components/ui/primitives';
import { useRouter } from 'next/navigation';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const toMin = (hm: string) => { const [h, m] = hm.split(':').map(Number); return h * 60 + m; };
const toHM = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

export function ChannelSettings({ channel }: { channel: any }) {
  const router = useRouter(); const me = useMe(); const ent = me.data?.organization?.entitlements ?? {};
  const update = useMutate(M.updateChannel, { invalidate: [['channel', channel.id], ['channels'], ['targets']], success: 'Saved' });
  const setSchedule = useMutate(M.setPostingSchedule, { invalidate: [['channel', channel.id], ['targets']], success: 'Posting schedule updated' });
  const remove = useMutate(M.removeChannel, { invalidate: [['channels']], success: 'Channel removed', onSuccess: () => router.push('/channels') });
  const [tz, setTz] = useState(channel.timezone); const [goal, setGoal] = useState<number | ''>(channel.postingGoalPerWeek ?? '');
  const [byDay, setByDay] = useState<Record<number, string[]>>(channel.scheduleByDay ?? {});
  const [newTime, setNewTime] = useState('10:00'); const [newDays, setNewDays] = useState<number[]>([1, 2, 3, 4, 5]); const [del, setDel] = useState(false);
  const link = channel.meta?.linkSettings ?? {};
  const persist = (next: Record<number, string[]>) => { setByDay(next); setSchedule.mutate({ channelId: channel.id, slots: Object.entries(next).flatMap(([wd, times]) => times.map(t => ({ weekday: Number(wd), minuteOfDay: toMin(t), enabled: true }))) }); };
  const addTimes = () => { const next = { ...byDay }; for (const d of newDays) next[d] = Array.from(new Set([...(next[d] ?? []), newTime])).sort(); persist(next); };
  const recommend = () => { const rec: Record<number, string[]> = {}; for (const d of [1, 2, 3, 4, 5]) rec[d] = ['09:57', '13:12', '17:48']; rec[0] = ['11:03']; rec[6] = ['10:31']; persist(rec); };   // seeded recommendation; replaced by best-time analytics once ≥ 20 posts exist

  return (
    <div className="grid" style={{ gridTemplateColumns: 'minmax(0,1fr)', maxWidth: 820 }}>
      <section className="card" aria-labelledby="general"><h2 id="general" style={{ marginTop: 0, fontSize: 16 }}>General</h2>
        <div className="field"><label htmlFor="tz">Timezone</label><select id="tz" className="select" value={tz} onChange={e => { setTz(e.target.value); update.mutate({ id: channel.id, timezone: e.target.value }); }}>{tzList().map(z => <option key={z} value={z}>{z.replace(/_/g, ' ')}</option>)}</select><span className="hint">Posts publish in this timezone. Changing it moves queued posts (not custom-time posts).</span></div>
        <div className="field"><label className="row"><input type="checkbox" checked={channel.isPaused} onChange={e => update.mutate({ id: channel.id, isPaused: e.target.checked })} /> Pause queue</label></div>
        {['INSTAGRAM', 'TIKTOK', 'YOUTUBE', 'FACEBOOK'].includes(channel.network) && <div className="field"><label className="row"><input type="checkbox" checked={channel.notifyByDefault} onChange={e => update.mutate({ id: channel.id, notifyByDefault: e.target.checked })} /> Enable "Notify me" by default for new posts</label></div>}
        <div className="field"><label htmlFor="goal">Posting goal per week</label><select id="goal" className="select" value={goal} onChange={e => { const v = e.target.value === '' ? '' : Number(e.target.value); setGoal(v); update.mutate({ id: channel.id, postingGoalPerWeek: v === '' ? null : v }); }}><option value="">No goal</option>{[1, 2, 3, 4, 5, 7, 10, 14].map(n => <option key={n} value={n}>{n}× per week</option>)}</select></div>
      </section>

      <section className="card" aria-labelledby="sched"><h2 id="sched" style={{ marginTop: 0, fontSize: 16 }}>Posting schedule</h2>
        <p className="subtle">Queued posts fill these weekly slots in order. Times are in {tz.replace(/_/g, ' ')}.</p>
        <div className="sched-grid">{DAYS.map((d, i) => <div key={d} className="sched-day"><h4>{d}</h4>{(byDay[i] ?? []).map(t => <div key={t} className="sched-time"><span>{t}</span><button className="btn ghost sm" aria-label={`Remove ${t} on ${d}`} onClick={() => persist({ ...byDay, [i]: byDay[i].filter(x => x !== t) })}>✕</button></div>)}{!(byDay[i] ?? []).length && <span className="subtle" style={{ fontSize: 11 }}>—</span>}</div>)}</div>
        <div className="row" style={{ marginTop: 12, flexWrap: 'wrap' }}>
          <input className="input" type="time" style={{ width: 130 }} value={newTime} onChange={e => setNewTime(e.target.value)} aria-label="New posting time" />
          <div className="row" style={{ gap: 2 }}>{DAYS.map((d, i) => <button key={d} className={`btn sm ${newDays.includes(i) ? 'primary' : 'secondary'}`} aria-pressed={newDays.includes(i)} onClick={() => setNewDays(ds => ds.includes(i) ? ds.filter(x => x !== i) : [...ds, i])}>{d[0]}</button>)}</div>
          <button className="btn ghost sm" onClick={() => setNewDays([0, 1, 2, 3, 4, 5, 6])}>Every day</button><button className="btn ghost sm" onClick={() => setNewDays([1, 2, 3, 4, 5])}>Weekdays</button><button className="btn ghost sm" onClick={() => setNewDays([0, 6])}>Weekends</button>
          <button className="btn secondary sm" onClick={addTimes} disabled={!newDays.length}>Add posting time</button>
        </div>
        <div className="row" style={{ marginTop: 12 }}><button className="btn secondary sm" onClick={recommend}>✨ Generate recommended times</button><button className="btn ghost sm" onClick={() => persist({})}>Clear all</button></div>
      </section>

      <section className="card" aria-labelledby="links"><h2 id="links" style={{ marginTop: 0, fontSize: 16 }}>Links &amp; tracking</h2>
        <div className="field"><label htmlFor="short">Link shortening {!ent.shortenerChoice && <UpgradeHint feature="Shortener choice" />}</label><select id="short" className="select" disabled={!ent.shortenerChoice} value={link.linkShortener ?? 'relay'} onChange={e => update.mutate({ id: channel.id, meta: { ...channel.meta, linkSettings: { ...link, linkShortener: e.target.value } } })}><option value="relay">rly.to (with click tracking)</option><option value="bitly">Bitly (connect in Settings → Integrations)</option><option value="none">Don't shorten</option></select></div>
        <div className="field"><label className="row"><input type="checkbox" disabled={!ent.customUtm} checked={!!link.utm?.enabled} onChange={e => update.mutate({ id: channel.id, meta: { ...channel.meta, linkSettings: { ...link, utm: { ...(link.utm ?? { utm_source: '{network}', utm_medium: 'social' }), enabled: e.target.checked } } } })} /> Add UTM parameters to links {!ent.customUtm && <UpgradeHint feature="Custom UTM" />}</label>{link.utm?.enabled && <div className="grid" style={{ gridTemplateColumns: '1fr 1fr 1fr', marginTop: 6 }}>{['utm_source', 'utm_medium', 'utm_campaign'].map(k => <input key={k} className="input" placeholder={k} defaultValue={link.utm?.[k] ?? ''} aria-label={k} onBlur={e => update.mutate({ id: channel.id, meta: { ...channel.meta, linkSettings: { ...link, utm: { ...link.utm, [k]: e.target.value } } } })} />)}</div>}<span className="hint">Placeholders: {'{network}'}, {'{channel}'}, {'{tag}'}</span></div>
      </section>

      <section className="card" aria-labelledby="bulk"><h2 id="bulk" style={{ marginTop: 0, fontSize: 16 }}>Bulk upload</h2><p className="subtle">Schedule many posts from a CSV: columns <code>text, date (YYYY-MM-DD HH:mm, optional), media_url_1..4, alt_1..4, first_comment, tags</code>.</p><a className="btn secondary sm" href={`/channels/${channel.id}/bulk`}>Open bulk upload</a></section>

      <section className="card" aria-labelledby="danger" style={{ borderColor: '#FECDCA' }}><h2 id="danger" style={{ marginTop: 0, fontSize: 16, color: 'var(--danger)' }}>Remove channel</h2><p className="subtle">Removes {channel.displayName} from Cadence and cancels its scheduled posts. Published posts stay on the network.</p><button className="btn danger sm" onClick={() => setDel(true)}>Remove channel</button></section>
      <Confirm open={del} onOpenChange={setDel} title={`Remove ${channel.displayName}?`} body={<p>Scheduled posts for this channel will be cancelled.</p>} confirmLabel="Remove" danger typed="REMOVE" onConfirm={() => remove.mutateAsync({ id: channel.id })} />
    </div>
  );
}
export { toHM };
