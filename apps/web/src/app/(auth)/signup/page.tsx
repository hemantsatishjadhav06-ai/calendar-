'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { rest } from '@/lib/api';

export default function SignupPage() {
  const router = useRouter();
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [error, setError] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm(f => ({ ...f, [k]: e.target.value }));
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError(null);
    try { await rest('/auth/signup', { method: 'POST', json: { ...form, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone } }); router.replace('/channels?welcome=1'); }
    catch (err: any) { setError(err.message); } finally { setBusy(false); }
  }
  return (
    <main className="auth-page" id="main">
      <form className="auth-card" onSubmit={submit} aria-labelledby="signup-title">
        <div className="row" style={{ marginBottom: 20 }}><span className="sidebar-logo">R</span><h1 id="signup-title" style={{ margin: 0, fontSize: 22 }}>Create your account</h1></div>
        {error && <div className="banner danger" role="alert">{error}</div>}
        <div className="field"><label htmlFor="name">Your name</label><input id="name" className="input" autoComplete="name" value={form.name} onChange={set('name')} /></div>
        <div className="field"><label htmlFor="email">Work email</label><input id="email" className="input" type="email" autoComplete="email" required value={form.email} onChange={set('email')} /></div>
        <div className="field"><label htmlFor="password">Password</label><input id="password" className="input" type="password" autoComplete="new-password" required minLength={10} value={form.password} onChange={set('password')} /><span className="hint">At least 10 characters.</span></div>
        <button className="btn primary" style={{ width: '100%', justifyContent: 'center' }} disabled={busy}>{busy ? 'Creating…' : 'Start free'}</button>
        <p className="subtle" style={{ textAlign: 'center', marginTop: 16 }}>Already have an account? <Link href="/login">Sign in</Link></p>
      </form>
    </main>
  );
}
