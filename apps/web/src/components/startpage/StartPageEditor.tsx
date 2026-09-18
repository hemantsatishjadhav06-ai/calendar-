'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { DndContext, closestCenter, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy, arrayMove } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, Eye, EyeOff, Trash2, Plus, ExternalLink } from 'lucide-react';
import { gql } from 'graphql-request';
import { useGql, useMutate } from '@/lib/hooks';
import { Menu, MenuItem } from '@/components/ui/primitives';
import { MediaTray } from '@/components/composer/MediaTray';
import { renderStartPage, THEME_PRESETS, type StartPageData } from './render';
import { toast } from '@/components/ui/toast';

const Q_PAGES = gql`query StartPages { startPages { id slug nickname theme header blocks publishedAt isPublished url stats } startPageThemes }`;
const M_CREATE = gql`mutation CreateSP($slug: String!, $nickname: String) { createStartPage(slug: $slug, nickname: $nickname) { id } }`;
const M_UPDATE = gql`mutation UpdateSP($id: ID!, $nickname: String, $theme: JSON, $header: JSON, $blocks: JSON) { updateStartPage(id: $id, nickname: $nickname, theme: $theme, header: $header, blocks: $blocks) { id } }`;
const M_PUBLISH = gql`mutation PublishSP($id: ID!, $publish: Boolean!) { publishStartPage(id: $id, publish: $publish) { id publishedAt } }`;
const Q_SLUG = gql`query Slug($slug: String!) { startPageSlugAvailable(slug: $slug) }`;

const BLOCK_TYPES: [string, string][] = [['link', 'Link button'], ['text', 'Text'], ['image', 'Image'], ['imageGrid', 'Image grid'], ['video', 'Video (YouTube/Vimeo/TikTok)'], ['youtubeLatest', 'Latest YouTube video'], ['spotify', 'Spotify'], ['social', 'Social icons'], ['mailchimp', 'Email signup (Mailchimp)'], ['updates', 'Updates (from Publish)'], ['divider', 'Divider']];
const uid = () => Math.random().toString(36).slice(2, 9);

export function StartPageEditor() {
  const pages = useGql<any>(['startPages'], Q_PAGES);
  const create = useMutate(M_CREATE, { invalidate: [['startPages'], ['channels']], success: 'Start Page created' });
  const [slug, setSlug] = useState('');
  const avail = useGql<any>(['slug', slug], Q_SLUG, { slug }, { enabled: slug.length >= 3 });
  const page = pages.data?.startPages?.[0];
  if (pages.isLoading) return <div className="skeleton" style={{ height: 300 }} />;
  if (!page) return (
    <div className="card" style={{ maxWidth: 520, margin: '24px auto' }}>
      <h2 style={{ marginTop: 0 }}>Create your link-in-bio page</h2>
      <p className="subtle">A fast, accessible microsite with your links, latest posts and an email signup — free on every plan.</p>
      <div className="field"><label htmlFor="slug">Address</label><div className="row"><input id="slug" className="input" placeholder="yourbrand" value={slug} onChange={e => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))} /><span className="subtle">.start.relay.app</span></div>{slug.length >= 3 && avail.data && <span className={avail.data.startPageSlugAvailable ? 'hint' : 'error'}>{avail.data.startPageSlugAvailable ? 'Available' : 'Taken'}</span>}</div>
      <button className="btn primary" disabled={slug.length < 3 || !avail.data?.startPageSlugAvailable} onClick={() => create.mutate({ slug })}>Create Start Page</button>
    </div>
  );
  return <Editor page={page} themes={pages.data.startPageThemes} />;
}

function Editor({ page, themes }: { page: any; themes: string[] }) {
  const [data, setData] = useState<StartPageData>({ nickname: page.nickname, theme: page.theme, header: page.header, blocks: page.blocks });
  const [tab, setTab] = useState<'content' | 'theme' | 'settings' | 'stats'>('content'); const [device, setDevice] = useState<'mobile' | 'desktop'>('mobile'); const [editing, setEditing] = useState<string | null>(null);
  const update = useMutate(M_UPDATE, { invalidate: [['startPages']] }); const publish = useMutate(M_PUBLISH, { invalidate: [['startPages']], success: page.isPublished ? 'Unpublished' : 'Published' });
  const timer = useRef<any>(null); const dirty = useRef(false);
  const set = (patch: Partial<StartPageData>) => { setData(d => { const next = { ...d, ...patch }; dirty.current = true; clearTimeout(timer.current); timer.current = setTimeout(() => { update.mutate({ id: page.id, nickname: next.nickname, theme: next.theme, header: next.header, blocks: next.blocks }); dirty.current = false; }, 800); return next; }); };
  useEffect(() => () => clearTimeout(timer.current), []);
  const setBlock = (id: string, patch: any) => set({ blocks: data.blocks.map(b => (b.id === id ? { ...b, ...patch } : b)) });
  const onDragEnd = (e: DragEndEvent) => { if (!e.over || e.active.id === e.over.id) return; const ids = data.blocks.map(b => b.id); set({ blocks: arrayMove(data.blocks, ids.indexOf(String(e.active.id)), ids.indexOf(String(e.over.id))) }); };
  const html = useMemo(() => renderStartPage(data, page.slug, { preview: true }), [data, page.slug]);
  const contrast = contrastRatio(data.theme.text, data.theme.background.type === 'color' ? data.theme.background.value : '#888888');
  return (
    <div className="grid" style={{ gridTemplateColumns: 'minmax(360px, 1fr) 420px', alignItems: 'start' }}>
      <div>
        <div className="row" style={{ marginBottom: 12, flexWrap: 'wrap' }}>
          <a href={page.url} target="_blank" rel="noreferrer" className="subtle" style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>{page.url.replace(/^https?:\/\//, '')} <ExternalLink size={12} /></a>
          <span style={{ flex: 1 }} />
          {page.isPublished ? <span className="tag brand">Published</span> : <span className="tag">Draft</span>}
          {update.isPending ? <span className="subtle">Saving…</span> : <span className="subtle">Saved</span>}
          <button className="btn secondary sm" onClick={() => publish.mutate({ id: page.id, publish: !page.isPublished })}>{page.isPublished ? 'Unpublish' : 'Publish'}</button>
          {page.isPublished && <button className="btn primary sm" onClick={() => { publish.mutate({ id: page.id, publish: true }); toast('Changes published'); }}>Publish changes</button>}
        </div>
        <div className="tabs" role="tablist" style={{ marginBottom: 12 }}>{(['content', 'theme', 'settings', 'stats'] as const).map(t => <button key={t} role="tab" aria-selected={tab === t} className="tab" style={{ border: 0, cursor: 'pointer', background: tab === t ? 'var(--bg-inset)' : 'none' }} onClick={() => setTab(t)}>{t[0].toUpperCase() + t.slice(1)}</button>)}</div>
        {tab === 'content' && <>
          <section className="card" style={{ marginBottom: 12 }}><h3 style={{ marginTop: 0, fontSize: 14 }}>Header</h3><div className="grid" style={{ gridTemplateColumns: '1fr 1fr' }}><div className="field"><label htmlFor="ht">Title</label><input id="ht" className="input" value={data.header.title ?? ''} onChange={e => set({ header: { ...data.header, title: e.target.value } })} /></div><div className="field"><label htmlFor="tg">Tagline</label><input id="tg" className="input" value={data.header.tagline ?? ''} onChange={e => set({ header: { ...data.header, tagline: e.target.value } })} /></div></div><div className="field"><label>Logo</label><MediaTray items={data.header.logoAssetId ? [{ assetId: data.header.logoAssetId, kind: 'image', thumbUrl: data.header.logoUrl }] : []} onChange={m => set({ header: { ...data.header, logoAssetId: m[0]?.assetId, logoUrl: m[0]?.previewUrl ?? m[0]?.thumbUrl } })} /></div><div className="field"><label>Social icons</label><div className="stack">{(data.header.socialIcons ?? []).map((s: any, i: number) => <div key={i} className="row"><select className="select" style={{ width: 140 }} value={s.network} onChange={e => set({ header: { ...data.header, socialIcons: data.header.socialIcons.map((x: any, k: number) => (k === i ? { ...x, network: e.target.value } : x)) } })}>{['instagram', 'x', 'tiktok', 'youtube', 'linkedin', 'facebook', 'threads', 'bluesky', 'mastodon', 'pinterest', 'website', 'email'].map(n => <option key={n}>{n}</option>)}</select><input className="input" placeholder="https://" value={s.url} onChange={e => set({ header: { ...data.header, socialIcons: data.header.socialIcons.map((x: any, k: number) => (k === i ? { ...x, url: e.target.value } : x)) } })} /><button className="btn ghost sm" onClick={() => set({ header: { ...data.header, socialIcons: data.header.socialIcons.filter((_: any, k: number) => k !== i) } })} aria-label="Remove icon">✕</button></div>)}<button className="btn ghost sm" style={{ alignSelf: 'flex-start' }} onClick={() => set({ header: { ...data.header, socialIcons: [...(data.header.socialIcons ?? []), { network: 'instagram', url: '' }] } })}>+ Add icon</button></div></div></section>
          <DndContext collisionDetection={closestCenter} onDragEnd={onDragEnd}><SortableContext items={data.blocks.map(b => b.id)} strategy={verticalListSortingStrategy}><div className="stack">{data.blocks.map(b => <BlockRow key={b.id} block={b} editing={editing === b.id} onEdit={() => setEditing(editing === b.id ? null : b.id)} onChange={p => setBlock(b.id, p)} onRemove={() => set({ blocks: data.blocks.filter(x => x.id !== b.id) })} />)}</div></SortableContext></DndContext>
          <Menu align="start" trigger={<button className="btn secondary" style={{ marginTop: 12 }}><Plus size={14} /> Add block</button>}>{BLOCK_TYPES.map(([t, l]) => <MenuItem key={t} onSelect={() => { const id = uid(); set({ blocks: [...data.blocks, defaultBlock(t, id)] }); setEditing(id); }}>{l}</MenuItem>)}</Menu>
        </>}
        {tab === 'theme' && <section className="card"><h3 style={{ marginTop: 0, fontSize: 14 }}>Theme</h3><div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(90px,1fr))' }}>{themes.map(id => { const p = THEME_PRESETS[id]; return <button key={id} className="card" aria-pressed={data.theme.id === id} style={{ padding: 8, border: data.theme.id === id ? '2px solid var(--fill-brand)' : undefined, background: p.background.value, color: p.text, cursor: 'pointer' }} onClick={() => set({ theme: { ...p, id } })}><div style={{ height: 24, borderRadius: 99, background: p.button.color, marginBottom: 6 }} /><span style={{ fontSize: 11 }}>{id}</span></button>; })}</div>
          <div className="grid" style={{ gridTemplateColumns: '1fr 1fr 1fr', marginTop: 14 }}>
            <div className="field"><label htmlFor="bgc">Background</label><input id="bgc" type="color" value={data.theme.background.type === 'color' ? data.theme.background.value : '#ffffff'} onChange={e => set({ theme: { ...data.theme, background: { type: 'color', value: e.target.value } } })} /></div>
            <div className="field"><label htmlFor="btc">Button</label><input id="btc" type="color" value={data.theme.button.color} onChange={e => set({ theme: { ...data.theme, button: { ...data.theme.button, color: e.target.value, textColor: contrastRatio('#0B1F0B', e.target.value) >= 4.5 ? '#0B1F0B' : '#FFFFFF' } } })} /></div>
            <div className="field"><label htmlFor="txc">Text</label><input id="txc" type="color" value={data.theme.text} onChange={e => set({ theme: { ...data.theme, text: e.target.value } })} /></div>
            <div className="field"><label htmlFor="bs">Button style</label><select id="bs" className="select" value={data.theme.button.style} onChange={e => set({ theme: { ...data.theme, button: { ...data.theme.button, style: e.target.value as any } } })}><option value="filled">Filled</option><option value="outline">Outline</option><option value="soft">Soft</option></select></div>
            <div className="field"><label htmlFor="br">Corners</label><select id="br" className="select" value={data.theme.button.radius} onChange={e => set({ theme: { ...data.theme, button: { ...data.theme.button, radius: e.target.value as any } } })}><option value="pill">Pill</option><option value="rounded">Rounded</option><option value="square">Square</option></select></div>
            <div className="field"><label htmlFor="ft">Font</label><select id="ft" className="select" value={data.theme.font.body} onChange={e => set({ theme: { ...data.theme, font: { heading: e.target.value, body: e.target.value } } })}>{['Inter', 'Georgia', 'Space Grotesk', 'DM Serif Display', 'Nunito', 'IBM Plex Mono'].map(f => <option key={f}>{f}</option>)}</select></div>
            <div className="field"><label htmlFor="bn">Banner</label><select id="bn" className="select" value={data.theme.banner} onChange={e => set({ theme: { ...data.theme, banner: e.target.value as any } })}><option value="none">None</option><option value="wave">Wave</option><option value="block">Block</option><option value="circle">Circle</option></select></div>
          </div>
          <p className={contrast < 4.5 ? 'error' : 'hint'} style={{ fontSize: 12 }}>{contrast < 4.5 ? `⚠ Text contrast ${contrast.toFixed(1)}:1 is below WCAG AA (4.5:1). Pick a darker text or lighter background.` : `Text contrast ${contrast.toFixed(1)}:1 ✓`}</p>
        </section>}
        {tab === 'settings' && <section className="card"><div className="field"><label htmlFor="nn">Nickname (internal)</label><input id="nn" className="input" value={data.nickname} onChange={e => set({ nickname: e.target.value })} /></div><div className="field"><label>Address</label><input className="input" value={page.url} disabled /><span className="hint">Custom domains are coming; contact support to reserve one.</span></div><div className="field"><label htmlFor="seo">SEO description</label><input id="seo" className="input" value={data.header.description ?? ''} onChange={e => set({ header: { ...data.header, description: e.target.value } })} maxLength={160} /></div></section>}
        {tab === 'stats' && <section className="card"><h3 style={{ marginTop: 0, fontSize: 14 }}>Last 30 days</h3><div className="tiles"><div className="tile"><div className="label">Views</div><div className="value">{page.stats?.views ?? 0}</div></div><div className="tile"><div className="label">Clicks</div><div className="value">{page.stats?.clicks ?? 0}</div></div><div className="tile"><div className="label">CTR</div><div className="value">{Math.round((page.stats?.ctr ?? 0) * 100)}%</div></div></div><table className="table" style={{ marginTop: 12 }}><thead><tr><th>Block</th><th>Clicks</th></tr></thead><tbody>{data.blocks.filter(b => ['link', 'image', 'imageGrid', 'social'].includes(b.type)).map(b => <tr key={b.id}><td>{b.label ?? b.type}</td><td>{page.stats?.byBlock?.[b.id] ?? 0}</td></tr>)}</tbody></table></section>}
      </div>
      <aside style={{ position: 'sticky', top: 'calc(var(--topbar-h) + 20px)' }} aria-label="Preview">
        <div className="row" style={{ justifyContent: 'center', marginBottom: 8 }}><button className={`btn sm ${device === 'mobile' ? 'primary' : 'secondary'}`} onClick={() => setDevice('mobile')}>Mobile</button><button className={`btn sm ${device === 'desktop' ? 'primary' : 'secondary'}`} onClick={() => setDevice('desktop')}>Desktop</button></div>
        <iframe title="Start Page preview" srcDoc={html} style={{ width: device === 'mobile' ? 375 : '100%', height: 700, border: '1px solid var(--border)', borderRadius: device === 'mobile' ? 28 : 12, background: '#fff', display: 'block', margin: '0 auto' }} sandbox="allow-same-origin" />
      </aside>
    </div>
  );
}

function BlockRow({ block: b, editing, onEdit, onChange, onRemove }: { block: any; editing: boolean; onEdit: () => void; onChange: (p: any) => void; onRemove: () => void }) {
  const s = useSortable({ id: b.id });
  return (
    <div ref={s.setNodeRef} className="card" style={{ padding: 10, transform: CSS.Transform.toString(s.transform), transition: s.transition, opacity: b.hidden ? .6 : 1 }}>
      <div className="row"><button className="drag-handle btn ghost icon sm" aria-label="Drag to reorder" {...s.attributes} {...s.listeners}><GripVertical size={14} /></button><button className="btn ghost" style={{ flex: 1, justifyContent: 'flex-start' }} onClick={onEdit} aria-expanded={editing}><b style={{ fontSize: 13 }}>{BLOCK_TYPES.find(t => t[0] === b.type)?.[1]}</b>&nbsp;<span className="subtle">{b.label ?? b.body?.slice(0, 40) ?? b.url ?? ''}</span></button><button className="btn ghost icon sm" onClick={() => onChange({ hidden: !b.hidden })} aria-label={b.hidden ? 'Show block' : 'Hide block'}>{b.hidden ? <EyeOff size={14} /> : <Eye size={14} />}</button><button className="btn ghost icon sm" onClick={onRemove} aria-label="Remove block"><Trash2 size={14} /></button></div>
      {editing && <div className="stack" style={{ marginTop: 8 }}>
        {'label' in b && <input className="input" placeholder="Label" value={b.label ?? ''} onChange={e => onChange({ label: e.target.value })} aria-label="Label" />}
        {'url' in b && <input className="input" placeholder="https://" value={b.url ?? ''} onChange={e => onChange({ url: e.target.value })} aria-label="URL" />}
        {b.type === 'text' && <textarea className="textarea" value={b.body ?? ''} onChange={e => onChange({ body: e.target.value })} aria-label="Text" />}
        {(b.type === 'image' || b.type === 'imageGrid') && <MediaTray items={(b.type === 'image' ? (b.assetId ? [{ assetId: b.assetId, kind: 'image', thumbUrl: b.src }] : []) : (b.items ?? []).map((i: any) => ({ assetId: i.assetId, kind: 'image', thumbUrl: i.src, altText: i.alt }))) as any} onChange={m => onChange(b.type === 'image' ? { assetId: m[0]?.assetId, src: m[0]?.previewUrl ?? m[0]?.thumbUrl, alt: m[0]?.altText } : { items: m.slice(0, 18).map(x => ({ assetId: x.assetId, src: x.previewUrl ?? x.thumbUrl, alt: x.altText, url: (b.items ?? []).find((i: any) => i.assetId === x.assetId)?.url })) })} />}
        {b.type === 'imageGrid' && <div className="stack">{(b.items ?? []).map((i: any, k: number) => <input key={k} className="input" placeholder={`Link for image ${k + 1} (optional)`} value={i.url ?? ''} onChange={e => onChange({ items: b.items.map((x: any, j: number) => (j === k ? { ...x, url: e.target.value } : x)) })} aria-label={`Link for image ${k + 1}`} />)}<select className="select" value={b.columns ?? 3} onChange={e => onChange({ columns: Number(e.target.value) })} aria-label="Columns"><option value={2}>2 columns</option><option value={3}>3 columns</option></select></div>}
        {b.type === 'mailchimp' && <><input className="input" placeholder="Mailchimp form action URL (https://…list-manage.com/subscribe/post?u=…&id=…)" value={b.action ?? ''} onChange={e => onChange({ action: e.target.value })} aria-label="Mailchimp form URL" /><input className="input" placeholder="Button label" value={b.buttonLabel ?? 'Subscribe'} onChange={e => onChange({ buttonLabel: e.target.value })} aria-label="Button label" /></>}
        {b.type === 'updates' && <select className="select" value={b.count ?? 5} onChange={e => onChange({ count: Number(e.target.value) })} aria-label="Number of posts"><option value={3}>Last 3 posts</option><option value={5}>Last 5 posts</option></select>}
        {b.type === 'youtubeLatest' && <input className="input" placeholder="YouTube channel ID (UC…)" value={b.channelId ?? ''} onChange={e => onChange({ channelId: e.target.value })} aria-label="YouTube channel ID" />}
      </div>}
    </div>
  );
}

function defaultBlock(type: string, id: string) {
  const base: any = { id, type, hidden: false };
  if (type === 'link') return { ...base, label: 'New link', url: 'https://' };
  if (type === 'text') return { ...base, body: 'Say hello 👋' };
  if (type === 'image') return { ...base, assetId: null, src: null, alt: '', url: '' };
  if (type === 'imageGrid') return { ...base, items: [], columns: 3 };
  if (type === 'video' || type === 'spotify') return { ...base, url: '' };
  if (type === 'youtubeLatest') return { ...base, channelId: '' };
  if (type === 'social') return { ...base };
  if (type === 'mailchimp') return { ...base, action: '', buttonLabel: 'Subscribe' };
  if (type === 'updates') return { ...base, count: 5, items: [] };
  return base;
}

export function contrastRatio(fg: string, bg: string) {
  const lum = (hex: string) => { const c = hex.replace('#', ''); const [r, g, b] = [0, 2, 4].map(i => parseInt(c.length === 3 ? c[i / 2] + c[i / 2] : c.slice(i, i + 2), 16) / 255).map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  try { const a = lum(fg), b = lum(bg); return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05); } catch { return 21; }
}
