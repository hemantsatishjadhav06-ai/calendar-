'use client';
import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { TopBar } from '@/components/shell/TopBar';
import { rest } from '@/lib/api';
import { Avatar } from '@/components/ui/primitives';
import { NETWORK_LABEL } from '@/lib/format';
import { toast } from '@/components/ui/toast';
import { useQueryClient } from '@tanstack/react-query';

/** After OAuth: pick which pages / accounts / locations to connect (Meta, LinkedIn, GBP, YouTube can expose several). */
export default function SelectPage() { return <Suspense fallback={null}><SelectInner /></Suspense>; }

function SelectInner() {
  const { network } = useParams<{ network: string }>(); const pick = useSearchParams().get('pick')!; const router = useRouter(); const qc = useQueryClient();
  const [data, setData] = useState<any>(null); const [sel, setSel] = useState<string[]>([]); const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  useEffect(() => { rest(`/oauth/pick/${pick}`).then(d => { setData(d); setSel(d.candidates.filter((c: any) => !c.alreadyConnected).slice(0, 1).map((c: any) => c.externalId)); }).catch(e => setError(e.message)); }, [pick]);
  const connect = async () => { setBusy(true); try { await rest(`/oauth/pick/${pick}/connect`, { method: 'POST', json: { externalIds: sel } }); qc.invalidateQueries({ queryKey: ['channels'] }); toast(`${sel.length} channel${sel.length > 1 ? 's' : ''} connected`, { tone: 'success' }); router.push('/channels?connected=1'); } catch (e: any) { toast(e.message, { tone: 'danger', extensions: e.extensions }); } finally { setBusy(false); } };
  return (
    <>
      <TopBar title={`Connect ${NETWORK_LABEL[network] ?? network}`} />
      <main className="content" id="main" style={{ maxWidth: 640 }}>
        {error && <div className="banner danger" role="alert">{error} <Link href="/channels/connect">Try again</Link></div>}
        {!data && !error && <div className="skeleton" style={{ height: 160 }} />}
        {data && <>
          <p>Choose what to connect. Each item becomes its own channel with its own queue and analytics.</p>
          <div className="stack">{data.candidates.map((c: any) => <label key={c.externalId} className="card row" style={{ cursor: c.alreadyConnected ? 'default' : 'pointer', opacity: c.alreadyConnected ? .6 : 1 }}><input type="checkbox" disabled={c.alreadyConnected} checked={sel.includes(c.externalId)} onChange={e => setSel(s => (e.target.checked ? [...s, c.externalId] : s.filter(x => x !== c.externalId)))} /><Avatar src={c.avatarUrl} name={c.displayName} network={c.network} /><div style={{ flex: 1 }}><b>{c.displayName}</b><div className="subtle">{NETWORK_LABEL[c.network]} · {c.subtype}{c.handle ? ` · ${c.handle}` : ''}</div></div>{c.alreadyConnected && <span className="tag">Already connected</span>}</label>)}</div>
          <div className="row" style={{ marginTop: 16, justifyContent: 'flex-end' }}><Link className="btn secondary" href="/channels">Cancel</Link><button className="btn primary" disabled={!sel.length || busy} onClick={connect}>{busy ? 'Connecting…' : `Connect ${sel.length || ''}`}</button></div>
        </>}
      </main>
    </>
  );
}
