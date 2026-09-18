'use client';
import { useEffect, useRef, useState } from 'react';
import { DndContext, closestCenter, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, useSortable, horizontalListSortingStrategy, arrayMove } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Plus } from 'lucide-react';
import type { MediaItem } from './store';
import { uploadFile, importUrl } from './upload';
import { toast } from '@/components/ui/toast';
import { Modal } from '@/components/ui/primitives';
import { streamAssist, rest } from '@/lib/api';

/** `listen` — only the composer's visible tray reacts to the editor toolbar's global "open media"/"paste files" events. */
export function MediaTray({ items, onChange, altMax = 1000, showCover, showUserTags, listen = false }: { items: MediaItem[]; onChange: (m: MediaItem[]) => void; altMax?: number; showCover?: boolean; showUserTags?: boolean; listen?: boolean }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [picker, setPicker] = useState(false);
  const [editing, setEditing] = useState<MediaItem | null>(null);
  const itemsRef = useRef(items); itemsRef.current = items;

  async function addFiles(files: File[]) {
    const temp: MediaItem[] = files.map(f => ({ assetId: `tmp-${Math.random()}`, kind: f.type.startsWith('video/') ? 'video' : f.type === 'image/gif' ? 'gif' : f.type === 'application/pdf' ? 'document' : 'image', status: 'uploading', progress: 0, previewUrl: f.type.startsWith('image/') ? URL.createObjectURL(f) : undefined }));
    onChange([...itemsRef.current, ...temp]);
    await Promise.all(files.map(async (f, i) => {
      const tmpId = temp[i].assetId;
      try {
        const done = await uploadFile(f, p => onChange(itemsRef.current.map(m => (m.assetId === tmpId ? { ...m, progress: p } : m))));
        onChange(itemsRef.current.map(m => (m.assetId === tmpId ? { ...done, previewUrl: done.previewUrl ?? m.previewUrl } : m)));
      } catch (e: any) { toast(`${f.name}: ${e.message}`, { tone: 'danger' }); onChange(itemsRef.current.filter(m => m.assetId !== tmpId)); }
    }));
  }
  useEffect(() => {
    if (!listen) return;
    const onOpen = () => fileRef.current?.click();
    const onPaste = (e: Event) => addFiles((e as CustomEvent).detail as File[]);
    document.addEventListener('relay:open-media', onOpen); document.addEventListener('relay:paste-files', onPaste);
    return () => { document.removeEventListener('relay:open-media', onOpen); document.removeEventListener('relay:paste-files', onPaste); };
  }, [listen]); // eslint-disable-line react-hooks/exhaustive-deps

  const onDragEnd = (e: DragEndEvent) => { if (!e.over || e.active.id === e.over.id) return; const ids = items.map(m => m.assetId); onChange(arrayMove(items, ids.indexOf(String(e.active.id)), ids.indexOf(String(e.over.id)))); };

  return (
    <div role="presentation" onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); addFiles(Array.from(e.dataTransfer.files)); }}>
      <div className="media-tray" role="list" aria-label="Attached media">
        <DndContext collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={items.map(m => m.assetId)} strategy={horizontalListSortingStrategy}>
            {items.map(m => <Thumb key={m.assetId} m={m} onEdit={() => setEditing(m)} onRemove={() => onChange(items.filter(x => x.assetId !== m.assetId))} />)}
          </SortableContext>
        </DndContext>
        <button className="media-add" onClick={() => setPicker(true)} aria-label="Add media"><Plus size={20} /></button>
        <input ref={fileRef} type="file" multiple accept="image/*,video/*,.pdf" hidden onChange={e => { addFiles(Array.from(e.target.files ?? [])); e.target.value = ''; }} />
      </div>
      <MediaPicker open={picker} onOpenChange={setPicker} onFiles={() => { setPicker(false); fileRef.current?.click(); }} onImported={m => { onChange([...itemsRef.current, m]); setPicker(false); }} />
      {editing && <AltTextModal item={editing} altMax={altMax} showCover={showCover} showUserTags={showUserTags} onClose={() => setEditing(null)} onSave={patch => { onChange(itemsRef.current.map(x => (x.assetId === editing.assetId ? { ...x, ...patch } : x))); setEditing(null); }} />}
    </div>
  );
}

function Thumb({ m, onEdit, onRemove }: { m: MediaItem; onEdit: () => void; onRemove: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: m.assetId });
  return (
    <div ref={setNodeRef} className="media-thumb" style={{ transform: CSS.Transform.toString(transform), transition }} {...attributes} {...listeners} role="listitem">
      {m.kind === 'video' ? (m.thumbUrl ? <img src={m.thumbUrl} alt="" /> : <div style={{ display: 'grid', placeItems: 'center', height: '100%' }}>▶</div>) : m.kind === 'document' ? <div style={{ display: 'grid', placeItems: 'center', height: '100%', fontSize: 12 }}>PDF</div> : <img src={m.thumbUrl ?? m.previewUrl} alt={m.altText ?? ''} />}
      {m.status === 'uploading' && <div style={{ position: 'absolute', inset: 0, background: 'rgba(255,255,255,.7)', display: 'grid', placeItems: 'center', fontSize: 11 }} aria-live="polite">{Math.round((m.progress ?? 0) * 100)}%</div>}
      {m.status === 'processing' && <div style={{ position: 'absolute', inset: 0, background: 'rgba(255,255,255,.7)', display: 'grid', placeItems: 'center', fontSize: 11 }}>Processing…</div>}
      <div className="ops"><button onClick={onEdit} aria-label="Edit media, alt text">{m.altText ? 'ALT ✓' : 'ALT'}</button><button onClick={onRemove} aria-label="Remove media">✕</button></div>
    </div>
  );
}

function AltTextModal({ item, altMax, showCover, showUserTags, onClose, onSave }: { item: MediaItem; altMax: number; showCover?: boolean; showUserTags?: boolean; onClose: () => void; onSave: (p: Partial<MediaItem>) => void }) {
  const [alt, setAlt] = useState(item.altText ?? ''); const [cover, setCover] = useState(item.cover?.offsetMs ?? 1000); const [tags, setTags] = useState<string>((item.userTags ?? []).map((t: any) => t.username).join(', ')); const [gen, setGen] = useState(false);
  const generate = async () => { setGen(true); let out = ''; try { await streamAssist({ action: 'alt_text', input: '', imageUrl: item.previewUrl }, d => { out += d; setAlt(out); }); } catch (e: any) { toast(e.message, { tone: 'danger' }); } finally { setGen(false); } };
  return (
    <Modal open onOpenChange={o => !o && onClose()} title="Media details" size="sm" footer={<><span style={{ flex: 1 }} /><button className="btn secondary" onClick={onClose}>Cancel</button><button className="btn primary" onClick={() => onSave({ altText: alt, cover: showCover && item.kind === 'video' ? { offsetMs: cover } : item.cover, userTags: showUserTags ? tags.split(',').map(s => s.trim().replace(/^@/, '')).filter(Boolean).map(username => ({ username, x: 0.5, y: 0.5 })) : item.userTags })}>Save</button></>}>
      <div className="stack">
        {item.kind !== 'document' && <div style={{ borderRadius: 10, overflow: 'hidden', background: 'var(--bg-inset)' }}>{item.kind === 'video' ? <video src={item.previewUrl} controls style={{ width: '100%', maxHeight: 260 }}><track kind="captions" /></video> : <img src={item.previewUrl ?? item.thumbUrl} alt={alt} style={{ width: '100%', maxHeight: 260, objectFit: 'contain' }} />}</div>}
        {item.kind !== 'video' && item.kind !== 'document' && (
          <div className="field"><label htmlFor="alt">Alt text <span className="subtle">({Array.from(alt).length}/{altMax})</span></label><textarea id="alt" className="textarea" value={alt} onChange={e => setAlt(e.target.value.slice(0, altMax))} placeholder="Describe the image for people who cannot see it" style={{ minHeight: 70 }} /><div className="row"><button className="btn secondary sm" disabled={gen} onClick={generate}>✦ {gen ? 'Generating…' : 'Generate with AI'}</button><span className="hint">Screen readers announce this text.</span></div></div>
        )}
        {showCover && item.kind === 'video' && <div className="field"><label htmlFor="cover">Cover frame (seconds)</label><input id="cover" type="range" min={0} max={Math.max(1, Math.floor((item.durationMs ?? 60000) / 1000))} step={0.5} value={cover / 1000} onChange={e => setCover(Number(e.target.value) * 1000)} /><span className="hint">{(cover / 1000).toFixed(1)}s — used as the thumbnail on Instagram, TikTok, Pinterest and YouTube.</span></div>}
        {showUserTags && item.kind === 'image' && <div className="field"><label htmlFor="tags">Tag people (Instagram usernames)</label><input id="tags" className="input" value={tags} onChange={e => setTags(e.target.value)} placeholder="@friend, @brand" /></div>}
      </div>
    </Modal>
  );
}

/** Upload / Unsplash / Giphy / URL picker (Canva, Drive, Dropbox open in their own pickers — see docs). */
function MediaPicker({ open, onOpenChange, onFiles, onImported }: { open: boolean; onOpenChange: (o: boolean) => void; onFiles: () => void; onImported: (m: MediaItem) => void }) {
  const [tab, setTab] = useState<'upload' | 'library' | 'unsplash' | 'pexels' | 'giphy' | 'url'>('upload');
  const [q, setQ] = useState(''); const [results, setResults] = useState<any[]>([]); const [busy, setBusy] = useState(false); const [url, setUrl] = useState('');
  useEffect(() => { if (tab === 'library' && open) rest('/uploads?kind=').then(r => setResults(r.items)).catch(() => setResults([])); }, [tab, open]);
  const search = async () => {
    setBusy(true);
    try {
      if (tab === 'unsplash') { const r = await fetch(`https://api.unsplash.com/search/photos?query=${encodeURIComponent(q)}&per_page=24&client_id=${process.env.NEXT_PUBLIC_UNSPLASH_ACCESS_KEY}`).then(r => r.json()); setResults(r.results ?? []); }
      if (tab === 'pexels') { const r = await fetch(`https://api.pexels.com/v1/search?query=${encodeURIComponent(q)}&per_page=24`, { headers: { Authorization: process.env.NEXT_PUBLIC_PEXELS_API_KEY ?? '' } }).then(r => r.json()); setResults(r.photos ?? []); }
      if (tab === 'giphy') { const r = await fetch(`https://api.giphy.com/v1/gifs/search?api_key=${process.env.NEXT_PUBLIC_GIPHY_API_KEY}&q=${encodeURIComponent(q)}&limit=24&rating=pg`).then(r => r.json()); setResults(r.data ?? []); }
    } finally { setBusy(false); }
  };
  const pick = async (u: string, source: string, meta: any) => { setBusy(true); try { onImported(await importUrl(u, source, meta)); } catch (e: any) { toast(e.message, { tone: 'danger' }); } finally { setBusy(false); } };
  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Add media">
      <div className="tabs" role="tablist" style={{ marginBottom: 12 }}>{(['upload', 'library', 'unsplash', 'pexels', 'giphy', 'url'] as const).map(t => <button key={t} role="tab" className="tab" aria-selected={tab === t} aria-current={tab === t ? 'page' : undefined} onClick={() => { setTab(t); setResults([]); }} style={{ border: 0, background: tab === t ? 'var(--bg-inset)' : 'none', cursor: 'pointer' }}>{{ upload: 'Upload', library: 'Library', unsplash: 'Unsplash', pexels: 'Pexels', giphy: 'GIFs', url: 'From URL' }[t]}</button>)}</div>
      {tab === 'upload' && <div className="empty" style={{ border: '2px dashed var(--border-strong)', borderRadius: 14 }}><h3>Drop files here</h3><p>Images up to 20 MB, videos up to 4 GB, PDFs for LinkedIn documents.</p><button className="btn primary" onClick={onFiles}>Choose files</button><p className="subtle" style={{ marginTop: 14 }}>Also: Canva, Google Drive, Dropbox and OneDrive pickers open from the ⋯ menu when configured.</p></div>}
      {(tab === 'unsplash' || tab === 'pexels' || tab === 'giphy') && <><form className="row" onSubmit={e => { e.preventDefault(); search(); }}><input className="input" placeholder={tab === 'giphy' ? 'Search GIFs' : 'Search free photos'} value={q} onChange={e => setQ(e.target.value)} aria-label="Search" /><button className="btn secondary" disabled={busy}>Search</button></form><div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(120px,1fr))', marginTop: 12 }}>{results.map((r: any) => tab === 'unsplash' ? <button key={r.id} className="media-thumb" style={{ width: '100%', height: 120, border: 0, cursor: 'pointer' }} onClick={() => pick(r.urls.full + '&w=2000&q=85&fm=jpg', 'unsplash', { author: r.user.name, authorUrl: r.user.links.html, downloadLocation: r.links.download_location })} aria-label={r.alt_description ?? 'Unsplash photo'}><img src={r.urls.small} alt={r.alt_description ?? ''} /></button> : tab === 'pexels' ? <button key={r.id} className="media-thumb" style={{ width: '100%', height: 120, border: 0, cursor: 'pointer' }} onClick={() => pick(r.src.large2x ?? r.src.large ?? r.src.original, 'pexels', { author: r.photographer, authorUrl: r.photographer_url, sourceUrl: r.url })} aria-label={r.alt ?? 'Pexels photo'}><img src={r.src.tiny ?? r.src.small} alt={r.alt ?? ''} /></button> : <button key={r.id} className="media-thumb" style={{ width: '100%', height: 120, border: 0, cursor: 'pointer' }} onClick={() => pick(r.images.downsized_medium?.url ?? r.images.original.url, 'giphy', { giphyId: r.id })} aria-label={r.title}><img src={r.images.fixed_height_small?.url} alt={r.title} /></button>)}</div><p className="subtle" style={{ marginTop: 10 }}>{tab === 'unsplash' ? 'Photos by Unsplash contributors — attribution is stored automatically.' : tab === 'pexels' ? 'Photos provided by Pexels — attribution is stored automatically.' : 'Powered by GIPHY'}</p></>}
      {tab === 'library' && <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(120px,1fr))' }}>{results.map((a: any) => <button key={a.id} className="media-thumb" style={{ width: '100%', height: 120, border: 0, cursor: 'pointer' }} onClick={() => onImported({ assetId: a.id, kind: a.kind, mime: a.mime, bytes: a.bytes, width: a.width, height: a.height, durationMs: a.durationMs, thumbUrl: a.thumbUrl, previewUrl: a.url, altText: a.altTextDefault ?? '', status: 'ready' })}><img src={a.thumbUrl} alt="" /></button>)}{!results.length && <p className="subtle">Nothing uploaded yet.</p>}</div>}
      {tab === 'url' && <form className="row" onSubmit={e => { e.preventDefault(); pick(url, 'url', {}); }}><input className="input" placeholder="https://…/image.jpg or video.mp4" value={url} onChange={e => setUrl(e.target.value)} aria-label="Media URL" /><button className="btn primary" disabled={busy || !url}>Import</button></form>}
    </Modal>
  );
}
