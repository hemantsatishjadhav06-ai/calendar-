'use client';
import { useState } from 'react';
import { GripVertical, MoreHorizontal, Smartphone, AlertTriangle, StickyNote, ExternalLink } from 'lucide-react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Avatar, Menu, MenuItem, MenuSep, Confirm } from '@/components/ui/primitives';
import { useMutate, M } from '@/lib/hooks';
import { fmtTime, fmtDateTime, NETWORK_LABEL, STATUS_LABEL, compact, truncate } from '@/lib/format';
import { useComposer } from '@/components/composer/store';
import { NotesModal } from './NotesModal';

export function PostCard({ t, zone, showChannel, sortable, canPublish = true, canApprove = false }: { t: any; zone?: string; showChannel?: boolean; sortable?: boolean; canPublish?: boolean; canApprove?: boolean }) {
  const open = useComposer(s => s.open);
  const [expanded, setExpanded] = useState(false); const [del, setDel] = useState(false); const [notes, setNotes] = useState(false); const [reject, setReject] = useState(false); const [reason, setReason] = useState('');
  const inv = { invalidate: [['targets'], ['channels']] };
  const moveTop = useMutate(M.moveToTop, inv), move = useMutate(M.moveTarget, inv), next = useMutate(M.moveToNextSlot, inv), now = useMutate(M.shareNow, { ...inv, success: 'Publishing now…' }), retry = useMutate(M.retryNow, { ...inv, success: 'Retrying…' }), addQ = useMutate(M.addToQueue, { ...inv, success: 'Added to queue' }), toDrafts = useMutate(M.moveToDrafts, inv), dup = useMutate(M.duplicatePost, { ...inv, success: 'Duplicated as draft' }), remove = useMutate(M.deletePost, { ...inv, success: 'Post deleted' }), approve = useMutate(M.approvePost, { ...inv, success: 'Approved' }), rejectM = useMutate(M.rejectPost, { ...inv, success: 'Sent back to drafts' }), revert = useMutate(M.revertApproval, inv), notifyDone = useMutate(M.markNotificationDone, { ...inv, success: 'Marked as posted' }), share = useMutate(M.createShareLink, { success: 'Share link copied — anyone with the link can preview this post', onSuccess: (d: any) => { try { navigator.clipboard.writeText(d.createShareLink); } catch { /* clipboard unavailable; link is shown in the toast */ } } }), reviewLink = useMutate(M.createReviewLink, { success: 'Client review link copied — they can approve or request changes', onSuccess: (d: any) => { try { navigator.clipboard.writeText(d.createReviewLink); } catch { /* clipboard unavailable */ } } });
  const sort = useSortable({ id: t.id, disabled: !sortable });
  const media: any[] = (t.customized ? t.media : t.post?.baseMedia?.length ? t.post.baseMedia : t.media) ?? [];
  const text = t.customized ? t.text : (t.post?.baseText || t.text);
  const z = zone ?? t.channel?.timezone;
  const label = `${NETWORK_LABEL[t.channel.network]} post, ${STATUS_LABEL[t.status]}${t.dueAt ? ` ${fmtDateTime(t.dueAt, z)}` : ''}. ${truncate(text, 80)}`;
  const isQueue = ['QUEUED', 'SCHEDULED', 'FAILED'].includes(t.status);
  return (
    <article ref={sort.setNodeRef} className="post-card" data-status={t.status} aria-label={label} style={{ transform: CSS.Transform.toString(sort.transform), transition: sort.transition, opacity: sort.isDragging ? .6 : 1 }}>
      <div className="stack" style={{ alignItems: 'center', gap: 6 }}>
        <Avatar src={t.channel.avatarUrl} name={t.channel.displayName} network={t.channel.network} />
        {sortable && !t.isCustomTime && t.status === 'QUEUED' && <button className="drag-handle btn ghost icon sm" aria-label="Drag to reorder" {...sort.attributes} {...sort.listeners}><GripVertical size={14} /></button>}
      </div>
      <div style={{ minWidth: 0 }}>
        <div className="head">
          {showChannel && <b style={{ color: 'var(--fg)' }}>{t.channel.displayName}</b>}
          {t.status === 'PUBLISHED' && t.publishedAt ? <span>Published {fmtDateTime(t.publishedAt, z)}</span> : t.dueAt ? <span>{fmtTime(t.dueAt, z)}</span> : <span>{STATUS_LABEL[t.status]}</span>}
          {t.isCustomTime && t.status !== 'PUBLISHED' && <span className="tag">Custom</span>}
          {t.schedulingType === 'NOTIFICATION' && <span className="tag warn"><Smartphone size={11} /> Notification</span>}
          {t.status === 'PENDING_APPROVAL' && <span className="tag warn">Awaiting approval</span>}
          {t.status === 'DRAFT' && t.metadata?.expired && <span className="tag">Expired</span>}
          {t.status === 'FAILED' && <span className="tag danger"><AlertTriangle size={11} /> Failed</span>}
          {t.status === 'NOTIFIED' && <span className="tag warn">Reminder sent</span>}
          {t.post?.aiAssisted && <span className="tag" title="Written with AI Assistant">✦</span>}
          {t.thread?.length > 0 && <span className="tag">Thread +{t.thread.length}</span>}
          {t.post?.createdBy && <span className="subtle">· {t.post.createdBy.name ?? t.post.createdBy.email}</span>}
        </div>
        {t.status === 'FAILED' && t.failureMessage && <div className="banner danger" style={{ padding: '6px 10px', margin: '0 0 8px' }}><span className="grow">{t.failureMessage}</span>{canPublish && t.channel.status === 'ACTIVE' && <button className="btn secondary sm" onClick={() => retry.mutate({ targetId: t.id })}>Retry now</button>}</div>}
        {/* Post text doubles as an expand/collapse toggle. Full button semantics are provided
            (role, focusability, Enter/Space, aria-expanded); only the underlying <p> tag — kept
            for the line-clamp typography — trips this rule. */}
        {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-to-interactive-role */}
        <p className={`text ${expanded ? 'expanded' : ''}`} role="button" tabIndex={0} aria-expanded={expanded} onClick={() => setExpanded(e => !e)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpanded(x => !x); } }}>{text}</p>
        {media.length > 0 && <ul className="media" aria-label={`${media.length} attachments`}>{media.slice(0, 4).map((m: any, i: number) => <li key={i}>{m.thumbUrl ? <img src={m.thumbUrl} alt={m.altText ?? ''} /> : <span className="more">{m.kind === 'video' ? '▶' : m.kind === 'document' ? 'PDF' : '🖼'}</span>}</li>)}{media.length > 4 && <li><span className="more">+{media.length - 4}</span></li>}</ul>}
        <div className="foot">
          {(t.post?.tags ?? []).map((tag: any) => <span key={tag.id} className="tag" style={{ background: tag.color + '22', color: tag.color }}>{tag.name}</span>)}
          {t.firstComment && <span className="tag" title={t.firstComment}>💬 first comment</span>}
          {t.status === 'PUBLISHED' && t.metrics && <span className="metrics">{t.metrics.impressions != null && <span title="Impressions">👁 {compact(t.metrics.impressions)}</span>}<span title="Reactions">♥ {compact(t.metrics.likes ?? 0)}</span><span title="Comments">💬 {compact(t.metrics.comments ?? 0)}</span><span title="Shares">↗ {compact(t.metrics.shares ?? 0)}</span></span>}
          {t.externalUrl && <a className="btn ghost sm" href={t.externalUrl} target="_blank" rel="noreferrer">View <ExternalLink size={12} /></a>}
          <button className="btn ghost sm" onClick={() => setNotes(true)} aria-label={`${t.post?.notesCount ?? 0} notes`}><StickyNote size={13} /> {t.post?.notesCount || ''}</button>
          {t.status === 'PENDING_APPROVAL' && canApprove && <><button className="btn primary sm" onClick={() => approve.mutate({ id: t.postId, mode: 'QUEUE' })}>Approve</button><button className="btn secondary sm" onClick={() => setReject(true)}>Reject</button></>}
          {t.status === 'NOTIFIED' && <><a className="btn secondary sm" href={`/notify/${t.id}`}>Open reminder</a><button className="btn ghost sm" onClick={() => notifyDone.mutate({ targetId: t.id })}>I posted this</button></>}
        </div>
      </div>
      <div className="actions">
        <Menu trigger={<button className="btn ghost icon sm" aria-label={`More actions for post: ${truncate(text, 30)}`}><MoreHorizontal size={16} /></button>}>
          {t.status !== 'PUBLISHED' && <MenuItem onSelect={() => open({ postId: t.postId })}>Edit</MenuItem>}
          <MenuItem onSelect={() => dup.mutate({ id: t.postId, asDraft: true })}>{t.status === 'PUBLISHED' ? 'Share again' : 'Duplicate'}</MenuItem>
          <MenuItem onSelect={() => share.mutate({ postId: t.postId })}>Copy share link</MenuItem>
          <MenuItem onSelect={() => reviewLink.mutate({ postId: t.postId })}>Copy client review link</MenuItem>
          {isQueue && canPublish && <><MenuSep /><MenuItem onSelect={() => moveTop.mutate({ targetId: t.id })}>Move to top</MenuItem><MenuItem onSelect={() => move.mutate({ targetId: t.id, direction: 'up' })} shortcut="Alt+↑">Move up</MenuItem><MenuItem onSelect={() => move.mutate({ targetId: t.id, direction: 'down' })} shortcut="Alt+↓">Move down</MenuItem><MenuItem onSelect={() => next.mutate({ targetId: t.id })}>Move to next available slot</MenuItem><MenuItem onSelect={() => now.mutate({ targetId: t.id })}>Share now</MenuItem><MenuItem onSelect={() => toDrafts.mutate({ targetId: t.id })}>Move to drafts</MenuItem></>}
          {t.status === 'FAILED' && canPublish && <MenuItem onSelect={() => addQ.mutate({ targetId: t.id })}>Re-add to queue</MenuItem>}
          {t.status === 'DRAFT' && canPublish && <><MenuSep /><MenuItem onSelect={() => addQ.mutate({ targetId: t.id })}>Add to queue</MenuItem><MenuItem onSelect={() => now.mutate({ targetId: t.id })}>Share now</MenuItem></>}
          {t.status === 'PENDING_APPROVAL' && <MenuItem onSelect={() => revert.mutate({ id: t.postId })}>Revert approval request</MenuItem>}
          <MenuSep />
          <MenuItem danger onSelect={() => setDel(true)}>Delete</MenuItem>
        </Menu>
      </div>
      <Confirm open={del} onOpenChange={setDel} title="Delete this post?" body={<p>This removes the post from {t.post?.targets?.length > 1 ? 'all its channels' : 'the queue'}. Published copies on the network are not affected.</p>} confirmLabel="Delete" danger onConfirm={() => remove.mutateAsync({ id: t.postId })} />
      <Confirm open={reject} onOpenChange={setReject} title="Reject this post" body={<div className="field"><label htmlFor="reason">Reason (sent to the author)</label><textarea id="reason" className="textarea" value={reason} onChange={e => setReason(e.target.value)} /></div>} confirmLabel="Reject" danger onConfirm={() => rejectM.mutateAsync({ id: t.postId, reason })} />
      {notes && <NotesModal postId={t.postId} onClose={() => setNotes(false)} />}
    </article>
  );
}
