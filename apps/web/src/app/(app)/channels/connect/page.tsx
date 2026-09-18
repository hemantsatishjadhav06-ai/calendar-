'use client';
import { useEffect, useRef, useState } from 'react';
import { TopBar } from '@/components/shell/TopBar';
import { useNetworks, useMe } from '@/lib/hooks';
import { NetworkIcon, Modal } from '@/components/ui/primitives';

export default function ConnectPage() {
  const networks = useNetworks(); const me = useMe();
  const [hintFor, setHintFor] = useState<any>(null); const [hint, setHint] = useState('');
  const hintRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (hintFor) hintRef.current?.focus(); }, [hintFor]);
  const start = (n: string, h?: string) => { window.location.href = `/api/oauth/${n}/start${h ? `?hint=${encodeURIComponent(h)}` : ''}`; };
  return (
    <>
      <TopBar title="Connect a channel" />
      <main className="content" id="main">
        <p className="subtle">You'll be sent to the network to sign in and grant access. Accept all permissions — each one maps to a feature (publishing, analytics, comments).</p>
        <div className="chan-grid">
          {(networks.data?.networks ?? [])
            .slice()
            .sort((a: any, b: any) => (b.configured ? 1 : 0) - (a.configured ? 1 : 0))
            .map((n: any) => (
              <button
                key={n.network}
                className="net-tile"
                disabled={!n.configured}
                style={!n.configured ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}
                title={!n.configured ? "Not set up yet — this network's app credentials haven't been added to Cadence" : undefined}
                onClick={() => { if (!n.configured) return; if (n.needsHint) setHintFor(n); else start(n.network); }}
              >
                <NetworkIcon network={n.network} />
                <div><b style={{ display: 'block' }}>{n.label}</b><span className="subtle">{n.configured ? (n.note ?? (n.rules?.thread ? `Threads up to ${n.rules.thread} parts` : '')) : 'Not set up yet'}</span></div>
              </button>
            ))}
        </div>
        <h2 style={{ fontSize: 15, marginTop: 28 }}>Before you connect</h2>
        <ul className="subtle">
          <li><b>Instagram</b> must be a Business or Creator account. Personal accounts can only use Notify-me reminders.</li>
          <li><b>Facebook Pages</b> need you to be an admin or editor. Groups only support Notify-me.</li>
          <li><b>LinkedIn Pages</b> require you to be a super admin or content admin of the page.</li>
          <li><b>TikTok</b> posts require choosing who can view each post at compose time (TikTok rule).</li>
          <li><b>Pinterest</b> analytics and video pins need a Business account.</li>
          <li>Free plan: {me.data?.organization?.entitlements?.channels === 'unlimited' ? 'unlimited channels' : `${me.data?.organization?.entitlements?.channels ?? 3} channels`}.</li>
        </ul>
      </main>
      {hintFor && <Modal open onOpenChange={o => !o && setHintFor(null)} title={`Connect ${hintFor.label}`} size="sm" footer={<><span style={{ flex: 1 }} /><button className="btn secondary" onClick={() => setHintFor(null)}>Cancel</button><button className="btn primary" disabled={!hint} onClick={() => start(hintFor.network, hint)}>Continue</button></>}>
        <div className="field"><label htmlFor="hint">{hintFor.needsHint === 'apikey' ? 'Your DEV.to API key' : hintFor.needsHint === 'server' ? 'Your Mastodon server' : 'Your Bluesky handle'}</label><input id="hint" className="input" type={hintFor.needsHint === 'apikey' ? 'password' : 'text'} autoComplete={hintFor.needsHint === 'apikey' ? 'off' : undefined} placeholder={hintFor.needsHint === 'apikey' ? 'Paste your API key' : hintFor.needsHint === 'server' ? 'mastodon.social' : 'you.bsky.social'} value={hint} onChange={e => setHint(e.target.value)} ref={hintRef} /><span className="hint">{hintFor.needsHint === 'apikey' ? 'Create one at DEV.to → Settings → Extensions → “DEV Community API Keys”. Stored encrypted.' : hintFor.needsHint === 'server' ? 'The domain of the instance where your account lives.' : 'We use your handle to find your account server (PDS).'}</span></div>
      </Modal>}
    </>
  );
}
