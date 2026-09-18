'use client';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { Settings, Shuffle, Pause, Play, RefreshCw } from 'lucide-react';
import { TopBar } from '@/components/shell/TopBar';
import { QueueList } from '@/components/publish/QueueList';
import { GridPreview } from '@/components/publish/GridPreview';
import { ChannelSettings } from '@/components/publish/ChannelSettings';
import { useChannel, useMe, useMutate, M } from '@/lib/hooks';
import { Avatar, Confirm } from '@/components/ui/primitives';
import { NETWORK_LABEL } from '@/lib/format';

const TABS = ['queue', 'drafts', 'approvals', 'sent', 'grid', 'settings'] as const;

export default function ChannelPage() {
  const { id, tab } = useParams<{ id: string; tab: string }>();
  const ch = useChannel(id); const me = useMe();
  const [showSlots, setShowSlots] = useState(true); const [shuffle, setShuffle] = useState(false);
  const update = useMutate(M.updateChannel, { invalidate: [['channel', id], ['channels'], ['targets']] });
  const doShuffle = useMutate(M.shuffleQueue, { invalidate: [['targets']], success: 'Queue shuffled' });
  const refresh = useMutate(M.refreshChannel, { invalidate: [['channel', id], ['channels']], success: 'Channel refreshed' });
  const c = ch.data?.channel;
  if (!c) return <><header className="topbar"><h1>Loading…</h1></header><div className="content"><div className="skeleton" style={{ height: 200 }} /></div></>;
  const access = c.myAccess ?? { publish: 'FULL' };
  const canPublish = access.publish === 'FULL'; const canApprove = canPublish; const ent = me.data?.organization?.entitlements ?? {};
  const t = (TABS as readonly string[]).includes(tab) ? tab : 'queue';
  const base = `/channels/${id}`;
  const tabs = [{ href: `${base}/queue`, label: 'Queue', count: c.queueCount }, { href: `${base}/drafts`, label: 'Drafts' }, ...(ent.approvals ? [{ href: `${base}/approvals`, label: 'Approvals' }] : []), { href: `${base}/sent`, label: 'Sent' }, ...(c.network === 'INSTAGRAM' ? [{ href: `${base}/grid`, label: 'Grid' }] : [])];
  return (
    <>
      <TopBar channelId={id} title={<span className="row"><Avatar src={c.avatarUrl} name={c.displayName} network={c.network} size="sm" /> {c.displayName} <span className="subtle" style={{ fontWeight: 400 }}>· {NETWORK_LABEL[c.network]}</span></span>} tabs={tabs}
        actions={<>{t === 'queue' && canPublish && <><button className="btn ghost sm" onClick={() => setShowSlots(s => !s)} aria-pressed={showSlots}>{showSlots ? 'Hide' : 'Show'} slots</button><button className="btn ghost icon sm" title={c.isPaused ? 'Resume queue' : 'Pause queue'} aria-label={c.isPaused ? 'Resume queue' : 'Pause queue'} onClick={() => update.mutate({ id, isPaused: !c.isPaused })}>{c.isPaused ? <Play size={15} /> : <Pause size={15} />}</button><button className="btn ghost icon sm" title="Shuffle queue" aria-label="Shuffle queue" onClick={() => setShuffle(true)}><Shuffle size={15} /></button></>}<a className="btn ghost icon sm" href={`${base}/settings`} aria-label="Channel settings" title="Settings"><Settings size={15} /></a></>} />
      <main className="content" id="main">
        {c.status === 'RECONNECT_REQUIRED' && <div className="banner danger" role="alert"><span className="grow"><b>Reconnect {c.displayName}.</b> {c.statusReason ?? 'Access expired'} — scheduled posts are paused until you reconnect.</span><button className="btn secondary sm" onClick={() => refresh.mutate({ id })}><RefreshCw size={13} /> Try refresh</button><a className="btn primary sm" href={`/api/oauth/${c.network}/start`}>Reconnect</a></div>}
        {c.status === 'LOCKED' && <div className="banner warn"><span className="grow">This channel is locked because it exceeds your plan's channel limit.</span><a className="btn primary sm" href="/billing">Upgrade</a></div>}
        {c.isPaused && t === 'queue' && <div className="banner info"><span className="grow">Queue paused — nothing will publish until you resume.</span><button className="btn secondary sm" onClick={() => update.mutate({ id, isPaused: false })}>Resume</button></div>}
        {t === 'settings' ? <ChannelSettings channel={c} /> : t === 'grid' ? <GridPreview channel={c} /> : <QueueList tab={t as any} channel={c} zone={c.timezone} showSlots={showSlots && t === 'queue'} canPublish={canPublish} canApprove={canApprove} />}
      </main>
      <Confirm open={shuffle} onOpenChange={setShuffle} title="Shuffle the queue?" body={<p>Randomly reorders the first 200 queued posts. Posts with a custom time stay where they are.</p>} confirmLabel="Shuffle" onConfirm={() => doShuffle.mutateAsync({ channelId: id })} />
    </>
  );
}
