'use client';
import { useParams, useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { TopBar } from '@/components/shell/TopBar';
import { rest } from '@/lib/api';
import { useMutate, M } from '@/lib/hooks';
import { Avatar } from '@/components/ui/primitives';
import { toast } from '@/components/ui/toast';
import { NETWORK_LABEL } from '@/lib/format';

/** Notify-me reminder page: copy caption, download media, follow steps, confirm. */
export default function NotifyPage() {
  const { id } = useParams<{ id: string }>(); const router = useRouter();
  const q = useQuery({ queryKey: ['notify', id], queryFn: () => rest(`/notify/${id}`) });
  const done = useMutate(M.markNotificationDone, { invalidate: [['targets']], success: 'Marked as posted', onSuccess: () => router.push(`/channels/${q.data?.channel.id}/sent`) });
  const d = q.data; if (!d) return <><TopBar title="Reminder" /><div className="content"><div className="skeleton" style={{ height: 240 }} /></div></>;
  const copy = (t: string) => { navigator.clipboard.writeText(t); toast('Copied'); };
  return (
    <>
      <TopBar title="Post reminder" />
      <main className="content" id="main" style={{ maxWidth: 640 }}>
        <div className="card">
          <div className="row" style={{ marginBottom: 12 }}><Avatar src={d.channel.avatarUrl} name={d.channel.displayName} network={d.channel.network} /><div><b>{d.channel.displayName}</b><div className="subtle">{NETWORK_LABEL[d.channel.network]} · {d.status === 'PUBLISHED' ? 'Posted' : 'Ready to post'}</div></div></div>
          <ol style={{ paddingLeft: 20 }}>{d.steps.map((s: string, i: number) => <li key={i} style={{ marginBottom: 4 }}>{s}</li>)}</ol>
          <h3 style={{ fontSize: 14 }}>Caption</h3><pre className="ai-out" style={{ fontFamily: 'inherit' }}>{d.text}</pre><button className="btn secondary sm" onClick={() => copy(d.text)}>Copy caption</button>
          {d.firstComment && <><h3 style={{ fontSize: 14 }}>First comment</h3><pre className="ai-out" style={{ fontFamily: 'inherit' }}>{d.firstComment}</pre><button className="btn secondary sm" onClick={() => copy(d.firstComment)}>Copy first comment</button></>}
          {d.media?.length > 0 && <><h3 style={{ fontSize: 14 }}>Media</h3><div className="row" style={{ flexWrap: 'wrap' }}>{d.media.map((m: any, i: number) => <a key={i} className="media-thumb" href={m.downloadUrl} download style={{ display: 'block' }} aria-label={`Download media ${i + 1}`}>{m.thumbUrl ? <img src={m.thumbUrl} alt="" /> : <span style={{ display: 'grid', placeItems: 'center', height: '100%' }}>⬇</span>}</a>)}</div></>}
          <div className="divider" />
          {d.status !== 'PUBLISHED' ? <div className="row"><button className="btn primary" onClick={() => done.mutate({ targetId: id, externalUrl: prompt('Paste the link to the published post (optional)') || undefined })}>I've posted this</button><span className="subtle">We'll try to match it automatically for analytics.</span></div> : <span className="tag brand">Posted</span>}
        </div>
      </main>
    </>
  );
}
