'use client';
import { useRef, useState } from 'react';
import { X as CloseIcon } from 'lucide-react';
import { streamAssist } from '@/lib/api';
import { useGql, useMutate, Q, M } from '@/lib/hooks';
import { toast } from '@/components/ui/toast';
import { UpgradeHint } from '@/components/ui/primitives';

function Panel({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return <aside className="side-panel" aria-label={title}><div className="head">{title}<button className="btn ghost icon sm" onClick={onClose} aria-label="Close panel"><CloseIcon size={16} /></button></div><div className="body">{children}</div></aside>;
}

export function AiPanel({ onClose, network, maxChars, currentText, onInsert }: { onClose: () => void; network?: string; maxChars?: number; currentText: string; onInsert: (t: string, replace: boolean) => void }) {
  const [prompt, setPrompt] = useState(''); const [out, setOut] = useState(''); const [busy, setBusy] = useState(false); const ctrl = useRef<AbortController | null>(null);
  const run = async (action: string, input: string, extra: Record<string, unknown> = {}) => {
    ctrl.current?.abort(); const c = new AbortController(); ctrl.current = c; setBusy(true); setOut('');
    try { let acc = ''; await streamAssist({ action, input, network, maxChars, ...extra }, d => { acc += d; setOut(acc); }, c.signal); }
    catch (e: any) { if (e.name !== 'AbortError') toast(e.message, { tone: 'danger', extensions: e.extensions }); } finally { setBusy(false); }
  };
  const quick: [string, string][] = [['rephrase', 'Rephrase'], ['shorten', 'Shorten'], ['expand', 'Expand'], ['casual', 'More casual'], ['formal', 'More formal'], ['hashtags', 'Hashtags']];
  return (
    <Panel title="AI Assistant" onClose={onClose}>
      <form onSubmit={e => { e.preventDefault(); run('generate', prompt); }} className="stack">
        <textarea className="textarea" style={{ minHeight: 70 }} placeholder="Describe the post you want (at least 4 words)…" value={prompt} onChange={e => setPrompt(e.target.value)} aria-label="Prompt" />
        <button className="btn primary sm" disabled={busy || prompt.trim().split(/\s+/).length < 4}>✦ Generate</button>
      </form>
      <div className="row" style={{ flexWrap: 'wrap', gap: 4, margin: '12px 0' }}>{quick.map(([a, l]) => <button key={a} className="btn secondary sm" disabled={busy || !currentText.trim()} onClick={() => run(a, currentText)}>{l}</button>)}{network && <button className="btn secondary sm" disabled={busy || !currentText.trim()} onClick={() => run('repurpose', currentText)}>Repurpose for {network}</button>}</div>
      <div className="ai-out" aria-live="polite">{out || <span className="subtle">{busy ? 'Thinking…' : 'Results appear here.'}</span>}</div>
      <div className="row" style={{ marginTop: 8 }}>
        <button className="btn primary sm" disabled={!out || busy} onClick={() => onInsert(out, false)}>Insert</button>
        <button className="btn secondary sm" disabled={!out || busy} onClick={() => onInsert(out, true)}>Replace</button>
        <button className="btn ghost sm" disabled={!out || busy} onClick={() => navigator.clipboard.writeText(out)}>Copy</button>
        {busy && <button className="btn ghost sm" onClick={() => ctrl.current?.abort()}>Stop</button>}
      </div>
      <p className="hint" style={{ marginTop: 12 }}>Posts created with AI are marked as AI-assisted in analytics. Always review facts before publishing.</p>
    </Panel>
  );
}

export function TemplatesPanel({ onClose, onUse }: { onClose: () => void; onUse: (body: string) => void }) {
  const [cat, setCat] = useState<string>(''); const templates = useGql<{ templates: any[] }>(['templates', cat], Q.templates, { category: cat || null });
  const cats = Array.from(new Set((templates.data?.templates ?? []).map(t => t.category).filter(Boolean)));
  return (
    <Panel title="Templates" onClose={onClose}>
      <select className="select" value={cat} onChange={e => setCat(e.target.value)} aria-label="Category" style={{ marginBottom: 10 }}><option value="">All categories</option>{cats.map(c => <option key={c} value={c}>{c}</option>)}</select>
      <div className="stack">{(templates.data?.templates ?? []).map(t => <div key={t.id} className="card" style={{ padding: 10 }}><div className="row" style={{ justifyContent: 'space-between' }}><b style={{ fontSize: 13 }}>{t.title}</b>{t.isLibrary ? <span className="tag">Library</span> : <span className="tag brand">Team</span>}</div><p className="subtle" style={{ margin: '4px 0 8px', whiteSpace: 'pre-wrap' }}>{t.body}</p><button className="btn secondary sm" onClick={() => onUse(t.body)}>Use template</button></div>)}</div>
    </Panel>
  );
}

export function HashtagPanel({ onClose, onInsert, entitled }: { onClose: () => void; onInsert: (tags: string[], where: 'text' | 'firstComment') => void; entitled: boolean }) {
  const groups = useGql<{ hashtagGroups: any[] }>(['hashtagGroups'], Q.hashtagGroups);
  const save = useMutate(M.saveHashtagGroup, { invalidate: [['hashtagGroups']], success: 'Group saved' });
  const del = useMutate(M.deleteHashtagGroup, { invalidate: [['hashtagGroups']] });
  const [name, setName] = useState(''); const [tags, setTags] = useState('');
  return (
    <Panel title="Hashtag manager" onClose={onClose}>
      {!entitled && <div className="banner info">Saved hashtag groups are available on paid plans. <UpgradeHint feature="Hashtag manager" /></div>}
      <div className="stack">{(groups.data?.hashtagGroups ?? []).map(g => <div key={g.id} className="card" style={{ padding: 10 }}><div className="row" style={{ justifyContent: 'space-between' }}><b style={{ fontSize: 13 }}>{g.name} <span className="subtle">({g.hashtags.length})</span></b><button className="btn ghost sm" onClick={() => del.mutate({ id: g.id })} aria-label={`Delete ${g.name}`}>✕</button></div><p className="subtle" style={{ margin: '4px 0 8px' }}>{g.hashtags.join(' ')}</p><div className="row"><button className="btn secondary sm" onClick={() => onInsert(g.hashtags, 'text')}>Insert in text</button><button className="btn ghost sm" onClick={() => onInsert(g.hashtags, 'firstComment')}>Insert in first comment</button></div></div>)}</div>
      {entitled && <form className="stack" style={{ marginTop: 14 }} onSubmit={e => { e.preventDefault(); save.mutate({ name, hashtags: tags.split(/[\s,]+/).filter(Boolean) }); setName(''); setTags(''); }}><input className="input" placeholder="Group name" value={name} onChange={e => setName(e.target.value)} aria-label="Group name" /><textarea className="textarea" style={{ minHeight: 60 }} placeholder="#launch #saas #startup" value={tags} onChange={e => setTags(e.target.value)} aria-label="Hashtags" /><button className="btn primary sm" disabled={!name || !tags}>Save group</button></form>}
    </Panel>
  );
}
