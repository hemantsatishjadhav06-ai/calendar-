'use client';
import { useState } from 'react';
import { Modal, Avatar } from '@/components/ui/primitives';
import { useGql, useMutate, Q, M } from '@/lib/hooks';
import { fmtDateTime } from '@/lib/format';

export function NotesModal({ postId, onClose }: { postId: string; onClose: () => void }) {
  const post = useGql<{ post: any }>(['post', postId], Q.post, { id: postId });
  const add = useMutate(M.addNote, { invalidate: [['post', postId], ['targets']] });
  const [body, setBody] = useState('');
  return (
    <Modal open onOpenChange={o => !o && onClose()} title="Notes" size="sm">
      <div className="stack">
        {(post.data?.post?.notes ?? []).map((n: any) => <div key={n.id} className="row" style={{ alignItems: 'flex-start' }}><Avatar src={n.author?.avatarUrl} name={n.author?.name ?? n.author?.email} size="sm" /><div><div className="subtle"><b style={{ color: 'var(--fg)' }}>{n.author?.name ?? n.author?.email}</b> · {fmtDateTime(n.createdAt)}{n.editedAt && ' (edited)'}</div><p style={{ margin: '2px 0 0', whiteSpace: 'pre-wrap' }}>{n.body}</p></div></div>)}
        {post.data && !post.data.post.notes.length && <p className="subtle">No notes yet. Notes are visible to your team, never published.</p>}
        <form onSubmit={e => { e.preventDefault(); if (body.trim()) { add.mutate({ postId, body }); setBody(''); } }} className="row"><textarea className="textarea" style={{ minHeight: 44, flex: 1 }} value={body} onChange={e => setBody(e.target.value)} placeholder="Add a note for your team…" aria-label="New note" /><button className="btn primary" disabled={!body.trim()}>Add</button></form>
      </div>
    </Modal>
  );
}
