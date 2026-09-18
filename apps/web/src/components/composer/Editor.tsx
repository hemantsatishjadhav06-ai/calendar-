'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Smile, Hash, Link2, ImagePlus, Sparkles, ListPlus, Trash2, AtSign } from 'lucide-react';
import { useGql } from '@/lib/hooks';
import { M } from '@/lib/queries';
import { Menu, MenuItem, MenuSep } from '@/components/ui/primitives';
import { useQueryClient } from '@tanstack/react-query';
import type { NetworkRules } from '@cadence/network-rules';
import type { MediaItem, LinkPreview } from './store';
import { gqlRequest } from '@/lib/api';
import { Q } from '@/lib/queries';
import { importUrl } from './upload';

const URL_RE = /\bhttps?:\/\/[^\s<>()"']+/i;
const EMOJI = ['😀', '😂', '🥳', '😍', '🙌', '👏', '🔥', '✨', '🚀', '💡', '✅', '❤️', '👀', '🎉', '💪', '🙏', '📣', '🧵', '👇', '➡️'];

interface Props { value: string; onChange: (t: string) => void; media: MediaItem[]; onMedia: (m: MediaItem[]) => void; rules: NetworkRules | null; channelMeta: any; premium?: boolean; linkPreview: LinkPreview | null; onLinkPreview: (p: LinkPreview | null) => void; placeholder: string; onAi: () => void; onHashtags: () => void; allowThreads: boolean; thread: { text: string; media: MediaItem[] }[]; onThread: (t: { text: string; media: MediaItem[] }[]) => void }

export function Editor({ value, onChange, rules, channelMeta, premium, linkPreview, onLinkPreview, placeholder, onAi, onHashtags, allowThreads, thread, onThread, media }: Props) {
  const ta = useRef<HTMLTextAreaElement>(null);
  const [emoji, setEmoji] = useState(false);
  const ctx = { channel: { meta: channelMeta, subtype: '' }, metadata: {}, media: media as any, premium };
  const max = rules ? (typeof rules.text.max === 'function' ? rules.text.max(ctx) : rules.text.max) : 0;
  const count = rules ? rules.text.counter(value, ctx) : Array.from(value).length;
  const ratio = max ? count / max : 0;

  // Link preview: first URL in text, debounced
  const firstUrl = useMemo(() => value.match(URL_RE)?.[0], [value]);
  useEffect(() => {
    if (!firstUrl || (linkPreview && linkPreview.url === firstUrl) || linkPreview?.removed) return;
    const id = setTimeout(async () => {
      try { const r = await gqlRequest(Q.linkPreview, { url: firstUrl }); onLinkPreview({ ...r.linkPreview }); } catch { /* ignore */ }
    }, 600);
    return () => clearTimeout(id);
  }, [firstUrl]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!firstUrl && linkPreview) onLinkPreview(null); }, [firstUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  const insert = (s: string) => { const el = ta.current; if (!el) return onChange(value + s); const a = el.selectionStart ?? value.length, b = el.selectionEnd ?? value.length; onChange(value.slice(0, a) + s + value.slice(b)); requestAnimationFrame(() => { el.focus(); el.setSelectionRange(a + s.length, a + s.length); }); };
  const autosize = (el: HTMLTextAreaElement) => { el.style.height = 'auto'; el.style.height = Math.max(140, el.scrollHeight) + 'px'; };
  useEffect(() => { if (ta.current) autosize(ta.current); }, [value]);

  return (
    <div>
      <div className="editor">
        <textarea ref={ta} value={value} placeholder={placeholder} aria-label="Post text" onChange={e => onChange(e.target.value)} onKeyDown={e => { if (allowThreads && e.key === 'Enter' && (e.metaKey || e.ctrlKey) && e.shiftKey) { e.preventDefault(); onThread([...thread, { text: '', media: [] }]); } }} onPaste={e => { const f = Array.from(e.clipboardData.files); if (f.length) { e.preventDefault(); document.dispatchEvent(new CustomEvent('relay:paste-files', { detail: f })); } }} />
        <div className="editor-bar">
          <div style={{ position: 'relative' }}>
            <button className="btn ghost icon sm" aria-label="Emoji" aria-expanded={emoji} onClick={() => setEmoji(v => !v)}><Smile size={16} /></button>
            {emoji && <div className="popover" role="dialog" aria-label="Emoji picker" style={{ position: 'absolute', bottom: 36, left: 0, width: 260, display: 'grid', gridTemplateColumns: 'repeat(10,1fr)', gap: 2 }}>{EMOJI.map(e => <button key={e} className="btn ghost sm" style={{ padding: 4, fontSize: 18 }} onClick={() => { insert(e); setEmoji(false); }}>{e}</button>)}</div>}
          </div>
          <button className="btn ghost icon sm" aria-label="Hashtag manager" onClick={onHashtags}><Hash size={16} /></button>
          <MentionMenu onInsert={m => insert((value && !value.endsWith(' ') ? ' ' : '') + m)} />
          <button className="btn ghost icon sm" aria-label="Insert link" onClick={() => { const u = prompt('Paste a link'); if (u) insert((value.endsWith(' ') || !value ? '' : ' ') + u); }}><Link2 size={16} /></button>
          <button className="btn ghost icon sm" aria-label="Add media" onClick={() => document.dispatchEvent(new CustomEvent('relay:open-media'))}><ImagePlus size={16} /></button>
          <button className="btn ghost icon sm" aria-label="AI Assistant" onClick={onAi}><Sparkles size={16} /></button>
          {allowThreads && <button className="btn ghost sm" onClick={() => onThread([...thread, { text: '', media: [] }])} title="Add a thread part (⌘⇧Enter)"><ListPlus size={16} /> {thread.length ? `+ Part ${thread.length + 2}` : 'Start thread'}</button>}
          <span className={`counter ${ratio > 1 ? 'over' : ratio > 0.9 ? 'warn' : ''}`} aria-live="polite" aria-label={max ? `${count} of ${max} characters` : `${count} characters`}>{max ? `${count.toLocaleString()} / ${max.toLocaleString()}` : count.toLocaleString()}</span>
        </div>
      </div>
      {linkPreview && !linkPreview.removed && <LinkCard preview={linkPreview} editable={rules?.features.linkPreviewEditable === 'full'} onChange={onLinkPreview} onRemove={() => onLinkPreview({ ...linkPreview, removed: true })} />}
      {allowThreads && thread.map((p, i) => (
        <div key={i} className="editor" style={{ marginTop: 8, borderStyle: 'dashed' }}>
          <div className="row" style={{ justifyContent: 'space-between' }}><span className="subtle">Part {i + 2}</span><button className="btn ghost icon sm" aria-label={`Remove part ${i + 2}`} onClick={() => onThread(thread.filter((_, k) => k !== i))}><Trash2 size={14} /></button></div>
          <textarea value={p.text} aria-label={`Thread part ${i + 2}`} placeholder="Continue the thread…" style={{ minHeight: 80 }} onChange={e => onThread(thread.map((x, k) => (k === i ? { ...x, text: e.target.value } : x)))} />
          <div className="editor-bar"><span className={`counter ${rules && rules.text.counter(p.text, ctx) > max ? 'over' : ''}`}>{rules ? `${rules.text.counter(p.text, ctx)} / ${max}` : p.text.length}</span></div>
        </div>
      ))}
    </div>
  );
}

function LinkCard({ preview, editable, onChange, onRemove }: { preview: LinkPreview; editable: boolean; onChange: (p: LinkPreview) => void; onRemove: () => void }) {
  const [edit, setEdit] = useState(false);
  const [importing, setImporting] = useState(false);
  return (
    <div className="card" style={{ marginTop: 10, padding: 10, display: 'grid', gridTemplateColumns: preview.image ? '96px 1fr auto' : '1fr auto', gap: 10, alignItems: 'start' }}>
      {preview.image && <img src={preview.image} alt="" style={{ width: 96, height: 96, objectFit: 'cover', borderRadius: 8 }} />}
      <div style={{ minWidth: 0 }}>
        {edit ? (<div className="stack"><input className="input" value={preview.title ?? ''} onChange={e => onChange({ ...preview, title: e.target.value })} aria-label="Preview title" /><input className="input" value={preview.description ?? ''} onChange={e => onChange({ ...preview, description: e.target.value })} aria-label="Preview description" /></div>) : (<><b style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{preview.title ?? preview.url}</b><span className="subtle" style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{preview.description}</span><span className="subtle">{preview.siteName ?? new URL(preview.url).hostname}</span></>)}
        <div className="row" style={{ marginTop: 6, gap: 4 }}>
          {editable && <button className="btn ghost sm" onClick={() => setEdit(v => !v)}>{edit ? 'Done' : 'Edit preview'}</button>}
          {preview.image && !preview.imageAssetId && <button className="btn ghost sm" disabled={importing} onClick={async () => { setImporting(true); try { const m = await importUrl(preview.image!, 'link_preview'); onChange({ ...preview, imageAssetId: m.assetId }); } finally { setImporting(false); } }}>{importing ? 'Saving image…' : 'Use image on LinkedIn/Bluesky'}</button>}
          {preview.imageAssetId && <span className="tag brand">Image saved</span>}
        </div>
      </div>
      <button className="btn ghost icon sm" aria-label="Remove link preview" onClick={onRemove}>✕</button>
    </div>
  );
}

function MentionMenu({ onInsert }: { onInsert: (m: string) => void }) {
  const qc = useQueryClient();
  const mentions = useGql<{ savedMentions: any[] }>(['savedMentions'], Q.savedMentions);
  const list = mentions.data?.savedMentions ?? [];
  const add = async () => {
    const value = prompt('Mention to save (e.g. @acme). It will be inserted into the post text as-is.');
    if (!value?.trim()) return;
    const label = prompt('Label for this mention', value.replace(/^@/, '')) ?? value;
    await gqlRequest(M.saveSavedMention, { label, value });
    qc.invalidateQueries({ queryKey: ['savedMentions'] });
  };
  const remove = async (id: string) => { await gqlRequest(M.deleteSavedMention, { id }); qc.invalidateQueries({ queryKey: ['savedMentions'] }); };
  return (
    <Menu trigger={<button className="btn ghost icon sm" aria-label="Insert a saved mention"><AtSign size={16} /></button>} align="start">
      {list.map((m: any) => (
        <MenuItem key={m.id} onSelect={() => onInsert(m.value)}>{m.label}<span className="subtle" style={{ marginLeft: 6 }}>{m.value}</span></MenuItem>
      ))}
      {list.length > 0 && <MenuSep />}
      <MenuItem onSelect={add}>+ Save a mention…</MenuItem>
      {list.length > 0 && <MenuItem danger onSelect={() => { const m = list[list.length - 1]; if (confirm(`Remove saved mention "${m.label}"?`)) remove(m.id); }}>Remove last</MenuItem>}
    </Menu>
  );
}
