'use client';
import { Suspense, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { rest, setCurrentOrgId } from '@/lib/api';

export default function LoginPage() { return <Suspense fallback={null}><LoginInner /></Suspense>; }

function LoginInner() {
  const router = useRouter(); const params = useSearchParams();
  const [email, setEmail] = useState(''); const [password, setPassword] = useState(''); const [totp, setTotp] = useState('');
  const [needsTotp, setNeedsTotp] = useState(false); const [error, setError] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const totpRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (needsTotp) totpRef.current?.focus(); }, [needsTotp]);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError(null);
    try {
      const r = await rest('/auth/login', { method: 'POST', json: { email, password, totp: totp || undefined } });
      if (r.requiresTotp) { setNeedsTotp(true); return; }
      if (r.lastOrganizationId) setCurrentOrgId(r.lastOrganizationId);
      router.replace(params.get('next') ?? '/home');
    } catch (err: any) { setError(err.message); } finally { setBusy(false); }
  }
  return (
    <main className="auth-page" id="main">
      <form className="auth-card" onSubmit={submit} aria-labelledby="login-title">
        <div className="row" style={{ marginBottom: 20 }}><span className="sidebar-logo">C</span><h1 id="login-title" style={{ margin: 0, fontSize: 22 }}>Sign in to Cadence</h1></div>
        {error && <div className="banner danger" role="alert">{error}</div>}
        <div className="field"><label htmlFor="email">Email</label><input id="email" className="input" type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)} /></div>
        <div className="field"><label htmlFor="password">Password</label><input id="password" className="input" type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} /></div>
        {needsTotp && <div className="field"><label htmlFor="totp">Authentication code</label><input id="totp" className="input" inputMode="numeric" autoComplete="one-time-code" ref={totpRef} value={totp} onChange={e => setTotp(e.target.value)} /><span className="hint">From your authenticator app, or a recovery code.</span></div>}
        <button className="btn primary" style={{ width: '100%', justifyContent: 'center' }} disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        <p className="subtle" style={{ textAlign: 'center', marginTop: 16 }}>New here? <Link href="/signup">Create an account</Link></p>
      </form>
    </main>
  );
}
