'use client';
import { useState } from 'react';

export function ReviewActions({ token, existing }: { token: string; existing: any }) {
  const [decision, setDecision] = useState<'approved' | 'changes' | null>(existing?.clientDecision ?? null);
  const [name, setName] = useState(existing?.clientReviewerName ?? '');
  const [comment, setComment] = useState(existing?.clientComment ?? '');
  const [busy, setBusy] = useState(false); const [done, setDone] = useState<string | null>(existing?.clientDecision ?? null); const [err, setErr] = useState<string | null>(null);

  const submit = async (d: 'approved' | 'changes') => {
    setBusy(true); setErr(null); setDecision(d);
    try {
      const res = await fetch(`/api/review/${encodeURIComponent(token)}/decision`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ decision: d, reviewerName: name, comment }) });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? 'Something went wrong');
      setDone(d);
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };

  if (done) return (
    <div className="card" style={{ padding: 20, textAlign: 'center', marginTop: 8 }}>
      <div style={{ fontSize: 30, marginBottom: 6 }}>{done === 'approved' ? '✅' : '📝'}</div>
      <b style={{ display: 'block', fontSize: 16 }}>{done === 'approved' ? 'Thanks — you approved this post.' : 'Thanks — your change request was sent.'}</b>
      <p className="subtle" style={{ margin: '6px 0 0' }}>The team has been notified{comment ? ' with your note' : ''}. You can close this page.</p>
    </div>
  );

  return (
    <div className="card" style={{ padding: 20, marginTop: 8 }}>
      <b style={{ display: 'block', fontSize: 16, marginBottom: 4 }}>Your review</b>
      <p className="subtle" style={{ margin: '0 0 12px' }}>Approve this post, or ask for changes with a note. The team publishes once you're happy.</p>
      <div className="field"><label htmlFor="rv-name">Your name</label><input id="rv-name" className="input" value={name} onChange={e => setName(e.target.value)} placeholder="Jane from Acme" /></div>
      <div className="field"><label htmlFor="rv-comment">Comments {decision === 'changes' && <span style={{ color: 'var(--danger)' }}>(what to change)</span>}</label><textarea id="rv-comment" className="textarea" value={comment} onChange={e => setComment(e.target.value)} placeholder="Optional note for the team…" style={{ minHeight: 80 }} /></div>
      {err && <p style={{ color: 'var(--danger)', fontSize: 13 }}>{err}</p>}
      <div className="row" style={{ gap: 8, marginTop: 8 }}>
        <button className="btn primary" disabled={busy} onClick={() => submit('approved')} style={{ flex: 1 }}>{busy && decision === 'approved' ? 'Sending…' : 'Approve'}</button>
        <button className="btn secondary" disabled={busy} onClick={() => submit('changes')} style={{ flex: 1 }}>{busy && decision === 'changes' ? 'Sending…' : 'Request changes'}</button>
      </div>
    </div>
  );
}
