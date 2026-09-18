'use client';
import { useMemo, useState } from 'react';
import { DndContext, closestCorners, useDroppable, useDraggable, type DragEndEvent } from '@dnd-kit/core';
import { Plus, Sparkles, LayoutGrid, Columns } from 'lucide-react';
import { TopBar } from '@/components/shell/TopBar';
import { useGql, useMutate, useTags, Q, M } from '@/lib/hooks';
import { Modal, Menu, MenuItem, EmptyState } from '@/components/ui/primitives';
import { MediaTray } from '@/components/composer/MediaTray';
import { useComposer } from '@/components/composer/store';
import { streamAssist } from '@/lib/api';
import { toast } from '@/components/ui/toast';

export default function CreatePage() {
  const [view, setView] = useState<'board' | 'gallery'>('board'); const [search, setSearch] = useState(''); const [tagId, setTagId] = useState<string | undefined>();
  const [editing, setEditing] = useState<any>(null); const [genOpen, setGenOpen] = useState(false);
  const ideas = useGql<any>(['ideas', search, tagId], Q.ideas, { search: search || null, tagId: tagId ?? null, first: 100 });
  const tags = useTags(); const open = useComposer(s => s.open);
  const inv = { invalidate: [['ideas']] };
  const move = useMutate(M.moveIdea, inv), create = useMutate(M.createIdea, { ...inv, success: 'Idea saved' }), update = useMutate(M.updateIdea, { ...inv, success: 'Idea updated' }), del = useMutate(M.deleteIdea, { ...inv, success: 'Idea deleted' }), createGroup = useMutate(M.createIdeaGroup, inv), renameGroup = useMutate(M.renameIdeaGroup, inv), deleteGroup = useMutate(M.deleteIdeaGroup, inv);
  const groups: any[] = useMemo(() => [{ id: null, name: 'Unsorted' }, ...(ideas.data?.ideaGroups ?? [])], [ideas.data]);
  const list: any[] = (ideas.data?.ideas.edges ?? []).map((e: any) => e.node);
  const onDragEnd = (e: DragEndEvent) => { if (!e.over) return; const gid = String(e.over.id) === 'null' ? null : String(e.over.id); const idea = list.find(i => i.id === e.active.id); if (!idea || (idea.groupId ?? null) === gid) return; move.mutate({ id: idea.id, groupId: gid, sortOrder: list.filter(i => (i.groupId ?? null) === gid).length }); };
  return (
    <>
      <TopBar title="Create" actions={<><button className={`btn ghost icon sm`} aria-label="Board view" aria-pressed={view === 'board'} onClick={() => setView('board')}><Columns size={15} /></button><button className="btn ghost icon sm" aria-label="Gallery view" aria-pressed={view === 'gallery'} onClick={() => setView('gallery')}><LayoutGrid size={15} /></button><button className="btn secondary sm" onClick={() => setGenOpen(true)}><Sparkles size={14} /> Generate ideas</button><button className="btn secondary sm" onClick={() => setEditing({})}><Plus size={14} /> New idea</button></>} />
      <main className="content" id="main" style={{ maxWidth: 'none' }}>
        <div className="row" style={{ marginBottom: 12 }}><input className="input" style={{ width: 240, padding: '6px 10px' }} placeholder="Search ideas" value={search} onChange={e => setSearch(e.target.value)} aria-label="Search ideas" /><select className="select" style={{ width: 'auto', padding: '6px 10px' }} value={tagId ?? ''} onChange={e => setTagId(e.target.value || undefined)} aria-label="Filter by tag"><option value="">All tags</option>{(tags.data?.tags ?? []).map((t: any) => <option key={t.id} value={t.id}>{t.name}</option>)}</select><span style={{ flex: 1 }} /><button className="btn ghost sm" onClick={() => { const n = prompt('Group name'); if (n) createGroup.mutate({ name: n }); }}>+ New group</button></div>
        {ideas.data && !list.length && !search && <EmptyState title="Capture ideas before they vanish" body="Save text, links, images and videos here, organise them in groups, and turn them into posts when you're ready." action={<button className="btn primary" onClick={() => setEditing({})}>Save your first idea</button>} />}
        {view === 'board' ? (
          <DndContext collisionDetection={closestCorners} onDragEnd={onDragEnd}>
            <div style={{ display: 'grid', gridAutoFlow: 'column', gridAutoColumns: 'minmax(260px, 300px)', gap: 12, overflowX: 'auto', paddingBottom: 12 }}>
              {groups.map(g => <Column key={String(g.id)} group={g} ideas={list.filter(i => (i.groupId ?? null) === (g.id ?? null))} onEdit={setEditing} onPost={(i: any) => { open({ prefill: { text: i.body, media: i.media, ideaId: i.id } }); }} onDelete={(id: string) => del.mutate({ id })} onRename={() => { const n = prompt('Rename group', g.name); if (n) renameGroup.mutate({ id: g.id, name: n }); }} onDeleteGroup={() => deleteGroup.mutate({ id: g.id })} />)}
            </div>
          </DndContext>
        ) : (
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(200px,1fr))' }}>{list.map(i => <IdeaCard key={i.id} idea={i} onEdit={() => setEditing(i)} onPost={() => open({ prefill: { text: i.body, media: i.media, ideaId: i.id } })} onDelete={() => del.mutate({ id: i.id })} />)}</div>
        )}
      </main>
      {editing && <IdeaModal idea={editing} groups={groups} tags={tags.data?.tags ?? []} onClose={() => setEditing(null)} onSave={(input: any) => { editing.id ? update.mutate({ id: editing.id, input }) : create.mutate({ input }); setEditing(null); }} />}
      {genOpen && <GenerateModal onClose={() => setGenOpen(false)} onSave={body => create.mutate({ input: { body, aiGenerated: true } })} />}
    </>
  );
}

function Column({ group, ideas, onEdit, onPost, onDelete, onRename, onDeleteGroup }: any) {
  const { setNodeRef, isOver } = useDroppable({ id: String(group.id) });
  return (
    <section ref={setNodeRef} className="card" style={{ padding: 10, background: isOver ? 'var(--green-50)' : 'var(--bg-subtle)', minHeight: 200 }} aria-label={`${group.name} group`}>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}><b style={{ fontSize: 13 }}>{group.name} <span className="subtle">({ideas.length})</span></b>{group.id && <Menu trigger={<button className="btn ghost sm" aria-label="Group actions">⋯</button>}><MenuItem onSelect={onRename}>Rename</MenuItem><MenuItem danger onSelect={onDeleteGroup}>Delete group</MenuItem></Menu>}</div>
      <div className="stack">{ideas.map((i: any) => <DraggableIdea key={i.id} idea={i} onEdit={() => onEdit(i)} onPost={() => onPost(i)} onDelete={() => onDelete(i.id)} />)}</div>
    </section>
  );
}
function DraggableIdea(props: any) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: props.idea.id });
  return <div ref={setNodeRef} style={{ transform: transform ? `translate(${transform.x}px,${transform.y}px)` : undefined, opacity: isDragging ? .6 : 1 }} {...attributes} {...listeners}><IdeaCard {...props} /></div>;
}
function IdeaCard({ idea, onEdit, onPost, onDelete }: any) {
  const m = idea.media?.[0];
  return (
    <article className="card" style={{ padding: 10, cursor: 'grab' }} aria-label={idea.title ?? idea.body.slice(0, 40)}>
      {m?.thumbUrl && <img src={m.thumbUrl} alt="" style={{ width: '100%', borderRadius: 8, marginBottom: 6, maxHeight: 140, objectFit: 'cover' }} />}
      {idea.title && <b style={{ fontSize: 13, display: 'block' }}>{idea.title}</b>}
      <p style={{ margin: '2px 0 6px', fontSize: 13, display: '-webkit-box', WebkitLineClamp: 4, WebkitBoxOrient: 'vertical', overflow: 'hidden', whiteSpace: 'pre-wrap' }}>{idea.body}</p>
      <div className="row" style={{ flexWrap: 'wrap', gap: 4 }}>{idea.tags?.map((t: any) => <span key={t.id} className="tag" style={{ background: t.color + '22', color: t.color }}>{t.name}</span>)}{idea.aiGenerated && <span className="tag">✦ AI</span>}{idea.usedAt && <span className="tag brand">Used</span>}</div>
      <div className="row" style={{ marginTop: 6 }}><button className="btn primary sm" onPointerDown={e => e.stopPropagation()} onClick={onPost}>Create post</button><button className="btn ghost sm" onPointerDown={e => e.stopPropagation()} onClick={onEdit}>Edit</button><button className="btn ghost sm" onPointerDown={e => e.stopPropagation()} onClick={onDelete} aria-label="Delete idea">✕</button></div>
    </article>
  );
}
function IdeaModal({ idea, groups, tags, onClose, onSave }: any) {
  const [title, setTitle] = useState(idea.title ?? ''); const [body, setBody] = useState(idea.body ?? ''); const [media, setMedia] = useState<any[]>(idea.media ?? []); const [groupId, setGroupId] = useState(idea.groupId ?? ''); const [tagIds, setTagIds] = useState<string[]>((idea.tags ?? []).map((t: any) => t.id));
  return (
    <Modal open onOpenChange={o => !o && onClose()} title={idea.id ? 'Edit idea' : 'New idea'} size="sm" footer={<><span style={{ flex: 1 }} /><button className="btn secondary" onClick={onClose}>Cancel</button><button className="btn primary" onClick={() => onSave({ title: title || null, body, media: media.map(m => ({ assetId: m.assetId, kind: m.kind, thumbUrl: m.thumbUrl, altText: m.altText })), groupId: groupId || null, tagIds })}>Save</button></>}>
      <div className="field"><label htmlFor="it">Title (optional)</label><input id="it" className="input" value={title} onChange={e => setTitle(e.target.value)} /></div>
      <div className="field"><label htmlFor="ib">Idea</label><textarea id="ib" className="textarea" value={body} onChange={e => setBody(e.target.value)} placeholder="Notes, a caption draft, a link…" /></div>
      <MediaTray items={media} onChange={setMedia} />
      <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', marginTop: 10 }}><div className="field"><label htmlFor="ig">Group</label><select id="ig" className="select" value={groupId} onChange={e => setGroupId(e.target.value)}><option value="">Unsorted</option>{groups.filter((g: any) => g.id).map((g: any) => <option key={g.id} value={g.id}>{g.name}</option>)}</select></div><div className="field"><label>Tags</label><div className="row" style={{ flexWrap: 'wrap', gap: 4 }}>{tags.map((t: any) => <button key={t.id} className={`tag ${tagIds.includes(t.id) ? 'brand' : ''}`} style={{ border: 0, cursor: 'pointer' }} aria-pressed={tagIds.includes(t.id)} onClick={() => setTagIds(x => (x.includes(t.id) ? x.filter(i => i !== t.id) : [...x, t.id]))}>{t.name}</button>)}</div></div></div>
    </Modal>
  );
}
function GenerateModal({ onClose, onSave }: { onClose: () => void; onSave: (body: string) => void }) {
  const [biz, setBiz] = useState(''); const [aud, setAud] = useState(''); const [ideas, setIdeas] = useState<string[]>([]); const [busy, setBusy] = useState(false);
  const run = async () => { setBusy(true); setIdeas([]); let acc = ''; try { await streamAssist({ action: 'ideas', input: `Business: ${biz}\nAudience: ${aud}`, count: 6 }, d => { acc += d; setIdeas(acc.split('\n').map(s => s.replace(/^[-*\d.)\s]+/, '').trim()).filter(Boolean)); }); } catch (e: any) { toast(e.message, { tone: 'danger' }); } finally { setBusy(false); } };
  return (
    <Modal open onOpenChange={o => !o && onClose()} title="Generate ideas" size="sm">
      <div className="field"><label htmlFor="biz">Describe your business</label><input id="biz" className="input" value={biz} onChange={e => setBiz(e.target.value)} placeholder="A B2B SaaS for social media teams" /></div>
      <div className="field"><label htmlFor="aud">Who is the audience?</label><input id="aud" className="input" value={aud} onChange={e => setAud(e.target.value)} placeholder="Marketing managers at agencies" /></div>
      <button className="btn primary" disabled={busy || !biz} onClick={run}>✦ {busy ? 'Generating…' : ideas.length ? 'Try another set' : 'Generate'}</button>
      <div className="stack" style={{ marginTop: 12 }}>{ideas.map((i, k) => <div key={k} className="card row" style={{ padding: 10 }}><span style={{ flex: 1, fontSize: 13 }}>{i}</span><button className="btn secondary sm" onClick={() => { onSave(i); toast('Saved to Ideas'); }}>Use it</button></div>)}</div>
    </Modal>
  );
}
