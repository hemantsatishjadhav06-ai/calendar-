'use client';
import { Suspense, use, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';

const api = (p: string, init?: RequestInit) => fetch(`/api${p}`, init).then(async r => { if (!r.ok) throw new Error((await r.json().catch(() => ({}))).message ?? 'Request failed'); return r.json(); });

export default function ConnectPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  return <Suspense fallback={null}><ConnectInner token={token} /></Suspense>;
}

function ConnectInner({ token }: { token: string }) {
  const sp = useSearchParams();
  const pick = sp.get('pick'); const connected = sp.get('connected'); const err = sp.get('error');
  const [data, setData] = useState<any>(null); const [error, setError] = useState<string | null>(err);
  const [hintFor, setHintFor] = useState<any>(null); const [hint, setHint] = useState('');

  useEffect(() => { if (!pick) api(`/oauth/connect/${token}/networks`).then(setData).catch(e => setError(e.message)); }, [token, pick]);

  const start = (network: string, h?: string) => { window.location.href = `/api/oauth/connect/${token}/start/${network}${h ? `?hint=${encodeURIComponent(h)}` : ''}`; };

  return (
    <main id="main" style={{ minHeight: '100dvh', background: 'var(--bg, #faf9f7)', padding: '32px 16px' }}>
      <div style={{ maxWidth: 560, margin: '0 auto' }}>
        <header style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20 }}>
          <span aria-hidden style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 28, height: 28, borderRadius: 8, background: '#6DB44F', color: '#0b1b0b', fontWeight: 800 }}>C</span>
          <b style={{ fontSize: 15 }}>Cadence</b>
          {data?.org && <span className="subtle" style={{ marginLeft: 'auto' }}>Connect to {data.org}</span>}
        </header>

        {connected && <div className="banner" style={{ background: 'var(--green-50)', color: 'var(--green-700)', padding: 12, borderRadius: 10, marginBottom: 14 }}>✅ Channel connected. You can connect another below, or close this page.</div>}
        {error && <div className="banner danger" role="alert" style={{ marginBottom: 14 }}>{error}</div>}

        {pick ? <PickStep token={token} pickId={pick} network={sp.get('network') ?? ''} />
          : !data ? <div className="card" style={{ padding: 24, textAlign: 'center' }}>{error ? 'This link is invalid or expired.' : 'Loading…'}</div>
          : (
          <>
            <h1 style={{ fontSize: 18, margin: '0 0 4px' }}>Connect your channels</h1>
            <p className="subtle" style={{ marginTop: 0 }}>Pick a network to authorize. Your login goes straight to the network — {data.org} never sees your password.</p>
            <div className="chan-grid" style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fill,minmax(200px,1fr))' }}>
              {(data.networks ?? []).map((n: any) => (
                <button key={n.network} className="net-tile card" style={{ padding: 14, textAlign: 'left', cursor: 'pointer' }} onClick={() => { if (n.needsHint) { setHintFor(n); setHint(''); } else start(n.network); }}>
                  <b style={{ display: 'block' }}>{n.label}</b><span className="subtle">{n.note ?? 'Connect'}</span>
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      {hintFor && (
        <div role="dialog" aria-modal="true" aria-label={`Connect ${hintFor.label}`} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)', display: 'grid', placeItems: 'center', padding: 16 }}>
          <div className="card" style={{ padding: 20, width: 400, maxWidth: '100%' }}>
            <b style={{ display: 'block', marginBottom: 8 }}>Connect {hintFor.label}</b>
            <div className="field"><label htmlFor="h">{hintFor.needsHint === 'apikey' ? 'API key' : hintFor.needsHint === 'webhook' ? 'Webhook URL' : hintFor.needsHint === 'server' ? 'Server domain' : 'Handle'}</label><input id="h" className="input" type={hintFor.needsHint === 'apikey' ? 'password' : 'text'} value={hint} onChange={e => setHint(e.target.value)} placeholder={hintFor.needsHint === 'server' ? 'mastodon.social' : hintFor.needsHint === 'webhook' ? 'https://discord.com/api/webhooks/…' : hintFor.needsHint === 'apikey' ? 'Paste your key' : 'you.bsky.social'} /></div>
            <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}><button className="btn secondary" onClick={() => setHintFor(null)}>Cancel</button><button className="btn primary" disabled={!hint} onClick={() => start(hintFor.network, hint)}>Continue</button></div>
          </div>
        </div>
      )}
    </main>
  );
}

function PickStep({ token, pickId, network }: { token: string; pickId: string; network: string }) {
  const [cands, setCands] = useState<any[] | null>(null); const [sel, setSel] = useState<string[]>([]); const [busy, setBusy] = useState(false); const [done, setDone] = useState(false); const [error, setError] = useState<string | null>(null);
  useEffect(() => { api(`/oauth/connect/${token}/pick/${pickId}`).then(d => setCands(d.candidates)).catch(e => setError(e.message)); }, [token, pickId]);
  const connect = async () => { setBusy(true); try { await api(`/oauth/connect/${token}/pick/${pickId}/connect`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ externalIds: sel }) }); setDone(true); } catch (e: any) { setError(e.message); } finally { setBusy(false); } };
  if (done) return <div className="card" style={{ padding: 24, textAlign: 'center' }}>✅ Connected {sel.length} {network.toLowerCase()} {sel.length === 1 ? 'account' : 'accounts'}. You can close this page.</div>;
  return (
    <div className="card" style={{ padding: 20 }}>
      <b style={{ display: 'block', marginBottom: 8 }}>Choose which {network.toLowerCase()} accounts to connect</b>
      {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}
      {!cands ? <p className="subtle">Loading…</p> : cands.map(c => (
        <label key={c.externalId} className="row" style={{ padding: '8px 0', borderBottom: '1px solid var(--border)', opacity: c.alreadyConnected ? 0.5 : 1 }}>
          <input type="checkbox" disabled={c.alreadyConnected} checked={sel.includes(c.externalId)} onChange={e => setSel(s => e.target.checked ? [...s, c.externalId] : s.filter(x => x !== c.externalId))} />
          <span>{c.displayName}{c.handle ? ` · ${c.handle}` : ''}{c.alreadyConnected ? ' (already connected)' : ''}</span>
        </label>
      ))}
      <button className="btn primary" style={{ marginTop: 12 }} disabled={busy || !sel.length} onClick={connect}>{busy ? 'Connecting…' : `Connect ${sel.length || ''}`}</button>
    </div>
  );
}
