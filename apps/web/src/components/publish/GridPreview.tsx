'use client';
import { useState } from 'react';
import { useGql, useMutate, Q, M } from '@/lib/hooks';
import { fmtDate } from '@/lib/format';
import { useComposer } from '@/components/composer/store';

/** Instagram grid: published + scheduled in feed order; Shop Grid tab edits per-post links + header links. */
export function GridPreview({ channel }: { channel: any }) {
  const [tab, setTab] = useState<'preview' | 'shop'>('preview');
  const open = useComposer(s => s.open);
  const posts = useGql<any>(['targets', 'grid', channel.id], Q.targetsWithMetrics, { filter: { channelIds: [channel.id], status: ['PUBLISHED', 'QUEUED', 'SCHEDULED'] }, first: 100 });
  const update = useMutate(M.updateChannel, { invalidate: [['channel', channel.id]], success: 'Shop Grid saved' });
  const items: any[] = (posts.data?.targets.edges ?? []).map((e: any) => e.node).filter((t: any) => (t.metadata?.postType ?? 'post') !== 'story').sort((a: any, b: any) => new Date(b.publishedAt ?? b.dueAt ?? 0).getTime() - new Date(a.publishedAt ?? a.dueAt ?? 0).getTime());
  const shop = channel.meta?.shopGrid ?? { headerLinks: [], color: '#6DB44F' };
  const [links, setLinks] = useState<{ label: string; url: string }[]>(shop.headerLinks ?? []);
  return (
    <div>
      <div className="tabs" style={{ marginBottom: 14 }}><button className="tab" style={{ border: 0, cursor: 'pointer', background: tab === 'preview' ? 'var(--bg-inset)' : 'none' }} aria-current={tab === 'preview' ? 'page' : undefined} onClick={() => setTab('preview')}>Instagram preview</button><button className="tab" style={{ border: 0, cursor: 'pointer', background: tab === 'shop' ? 'var(--bg-inset)' : 'none' }} aria-current={tab === 'shop' ? 'page' : undefined} onClick={() => setTab('shop')}>Shop Grid</button></div>
      {tab === 'shop' && <div className="card" style={{ marginBottom: 14 }}><h3 style={{ marginTop: 0 }}>Shop Grid</h3><p className="subtle">A public page that mirrors your grid, with each post linking to a URL. Share it as your link in bio: <code>{`https://shop.relay.app/${channel.handle ?? channel.id}`}</code></p>{links.map((l, i) => <div key={i} className="row" style={{ marginBottom: 6 }}><input className="input" placeholder="Label" value={l.label} onChange={e => setLinks(ls => ls.map((x, k) => (k === i ? { ...x, label: e.target.value } : x)))} /><input className="input" placeholder="https://" value={l.url} onChange={e => setLinks(ls => ls.map((x, k) => (k === i ? { ...x, url: e.target.value } : x)))} /><button className="btn ghost sm" onClick={() => setLinks(ls => ls.filter((_, k) => k !== i))} aria-label="Remove link">✕</button></div>)}{links.length < 3 && <button className="btn secondary sm" onClick={() => setLinks(ls => [...ls, { label: '', url: '' }])}>+ Header link</button>}<div className="row" style={{ marginTop: 10 }}><button className="btn primary sm" onClick={() => update.mutate({ id: channel.id, meta: { ...channel.meta, shopGrid: { ...shop, headerLinks: links } } })}>Save</button></div></div>}
      <div style={{ maxWidth: 420, margin: '0 auto', display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 3 }}>
        {items.map((t: any) => { const m = (t.customized ? t.media : t.post?.baseMedia ?? t.media)?.[0]; const scheduled = t.status !== 'PUBLISHED'; return (
          <button key={t.id} style={{ aspectRatio: '1', border: 0, padding: 0, position: 'relative', background: 'var(--bg-inset)', cursor: 'pointer', opacity: scheduled ? .55 : 1 }} onClick={() => scheduled ? open({ postId: t.postId }) : window.open(t.externalUrl, '_blank')} aria-label={`${scheduled ? 'Scheduled' : 'Published'} ${fmtDate(t.publishedAt ?? t.dueAt)}: ${t.text.slice(0, 40)}`}>
            {m?.thumbUrl ? <img src={m.thumbUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <span style={{ fontSize: 11, padding: 6, display: 'block' }}>{t.text.slice(0, 40)}</span>}
            {scheduled && <span className="tag" style={{ position: 'absolute', top: 4, right: 4 }}>🕒</span>}
            {tab === 'shop' && <span className="tag brand" style={{ position: 'absolute', bottom: 4, left: 4 }}>{t.metadata?.shopGridLink ? '🔗' : 'No link'}</span>}
          </button>); })}
      </div>
      {!items.length && <p className="empty">No posts yet — publish or schedule an Instagram post to see the grid.</p>}
    </div>
  );
}
