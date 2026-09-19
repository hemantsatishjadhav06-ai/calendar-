'use client';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Suspense, useState } from 'react';
import { RefreshCw, Settings, Plus } from 'lucide-react';
import { TopBar } from '@/components/shell/TopBar';
import { useChannels, useMe, useMutate, useGql, M, Q } from '@/lib/hooks';
import { Avatar, Confirm, Menu, MenuItem, MenuSep, Modal } from '@/components/ui/primitives';
import { NETWORK_LABEL, fmtDateTime } from '@/lib/format';

export default function ChannelsPage() { return <Suspense fallback={null}><ChannelsInner /></Suspense>; }

function ChannelsInner() {
  const params = useSearchParams(); const channels = useChannels(); const me = useMe();
  const groups = useGql<any>(['channelGroups'], Q.channelGroups);
  const refresh = useMutate(M.refreshChannel, { invalidate: [['channels']], success: 'Channel checked' });
  const remove = useMutate(M.removeChannel, { invalidate: [['channels']], success: 'Channel removed' });
  const createGroup = useMutate(M.createChannelGroup, { invalidate: [['channelGroups']], success: 'Group created' });
  const updateGroup = useMutate(M.updateChannelGroup, { invalidate: [['channelGroups']], success: 'Group updated' });
  const deleteGroup = useMutate(M.deleteChannelGroup, { invalidate: [['channelGroups']] });
  const [del, setDel] = useState<any>(null); const [group, setGroup] = useState<any>(null);
  const list = channels.data?.channels ?? []; const ent = me.data?.organization?.entitlements ?? {}; const isAdmin = true;
  const limit = ent.channels === 'unlimited' ? null : ent.channels;
  return (
    <>
      <TopBar title="Channels" actions={<Link className="btn primary sm" href="/channels/connect"><Plus size={14} /> Connect channel</Link>} />
      <main className="content" id="main">
        {params.get('connected') && <div className="banner info" role="status">Channel connected. We seeded a default posting schedule — adjust it in the channel settings.</div>}
        {params.get('error') && <div className="banner danger" role="alert">Could not connect: {params.get('error')}</div>}
        {params.get('welcome') && <div className="banner info">Welcome to Cadence! Connect your first channel to start scheduling.</div>}
        <p className="subtle">{list.filter(c => c.network !== 'START_PAGE').length}{limit ? ` of ${limit}` : ''} channels connected{limit && list.length >= limit ? ' — upgrade to add more' : ''}.</p>
        <div className="chan-grid">
          {list.map(c => (
            <div key={c.id} className="card" style={{ display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: 12, alignItems: 'center', opacity: c.status === 'LOCKED' ? .7 : 1 }}>
              <Avatar src={c.avatarUrl} name={c.displayName} network={c.network} size="lg" />
              <div style={{ minWidth: 0 }}><b style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.displayName}</b><span className="subtle">{NETWORK_LABEL[c.network]} · {c.subtype}</span><div style={{ marginTop: 4 }}>{c.status === 'ACTIVE' && <span className="tag brand">Connected</span>}{c.status === 'RECONNECT_REQUIRED' && <span className="tag danger" title={c.statusReason}>Reconnect required</span>}{c.status === 'LOCKED' && <span className="tag warn">Locked</span>}{c.isPaused && <span className="tag">Paused</span>}</div></div>
              <Menu trigger={<button className="btn ghost icon" aria-label={`Actions for ${c.displayName}`}><Settings size={16} /></button>}>
                <MenuItem onSelect={() => (window.location.href = `/channels/${c.id}/queue`)}>Open queue</MenuItem>
                <MenuItem onSelect={() => (window.location.href = `/channels/${c.id}/settings`)}>Settings</MenuItem>
                {isAdmin && <><MenuItem onSelect={() => refresh.mutate({ id: c.id })}><RefreshCw size={13} /> Check connection</MenuItem><MenuItem onSelect={() => (window.location.href = `/api/oauth/${c.network}/start`)}>Reconnect</MenuItem><MenuSep /><MenuItem danger onSelect={() => setDel(c)}>Remove channel</MenuItem></>}
              </Menu>
              {c.status === 'RECONNECT_REQUIRED' && <a className="btn primary sm" style={{ gridColumn: '1 / -1' }} href={`/api/oauth/${c.network}/start`}>Reconnect {NETWORK_LABEL[c.network]}</a>}
              {c.lastHealthCheckAt && <span className="subtle" style={{ gridColumn: '1 / -1', fontSize: 11 }}>Last checked {fmtDateTime(c.lastHealthCheckAt)}</span>}
            </div>
          ))}
          <Link className="net-tile" href="/channels/connect" style={{ justifyContent: 'center', borderStyle: 'dashed', textDecoration: 'none' }}><Plus size={18} /> Connect a new channel</Link>
        </div>

        <h2 style={{ fontSize: 16, marginTop: 32 }}>Channel groups</h2>
        <p className="subtle">Group channels (e.g. per client or region) to pick them together in the composer and filters.</p>
        <div className="chan-grid">
          {(groups.data?.organization?.channelGroups ?? []).map((g: any) => <div key={g.id} className="card row" style={{ justifyContent: 'space-between' }}><div><b>{g.name}</b><div className="row" style={{ marginTop: 6 }}>{g.channelIds.map((id: string) => { const c = list.find(x => x.id === id); return c ? <Avatar key={id} src={c.avatarUrl} name={c.displayName} network={c.network} size="sm" /> : null; })}</div></div><div className="row"><button className="btn ghost sm" onClick={() => setGroup(g)}>Edit</button><button className="btn ghost sm" onClick={() => deleteGroup.mutate({ id: g.id })}>Delete</button></div></div>)}
          <button className="net-tile" style={{ justifyContent: 'center', borderStyle: 'dashed' }} onClick={() => setGroup({ name: '', channelIds: [] })}><Plus size={16} /> New group</button>
        </div>
      </main>
      <Confirm open={!!del} onOpenChange={o => !o && setDel(null)} title={`Remove ${del?.displayName}?`} body={<p>Scheduled posts for this channel will be cancelled. You can reconnect later.</p>} confirmLabel="Remove" danger onConfirm={() => remove.mutateAsync({ id: del.id })} />
      {group && <GroupModal group={group} channels={list} onClose={() => setGroup(null)} onSave={g => { if (g.id) updateGroup.mutate({ id: g.id, name: g.name, channelIds: g.channelIds }); else createGroup.mutate({ name: g.name, channelIds: g.channelIds }); setGroup(null); }} />}
    </>
  );
}

function GroupModal({ group, channels, onClose, onSave }: { group: any; channels: any[]; onClose: () => void; onSave: (g: any) => void }) {
  const [g, setG] = useState(group);
  return (
    <Modal open onOpenChange={o => !o && onClose()} title={g.id ? 'Edit group' : 'New channel group'} size="sm" footer={<><span style={{ flex: 1 }} /><button className="btn secondary" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!g.name || !g.channelIds.length} onClick={() => onSave(g)}>Save</button></>}>
      <div className="field"><label htmlFor="gname">Name</label><input id="gname" className="input" value={g.name} onChange={e => setG({ ...g, name: e.target.value })} /></div>
      <div className="stack">{channels.map(c => <label key={c.id} className="row"><input type="checkbox" checked={g.channelIds.includes(c.id)} onChange={e => setG({ ...g, channelIds: e.target.checked ? [...g.channelIds, c.id] : g.channelIds.filter((x: string) => x !== c.id) })} /><Avatar src={c.avatarUrl} name={c.displayName} network={c.network} size="sm" /> {c.displayName}</label>)}</div>
    </Modal>
  );
}
