'use client';
import { useEffect, useMemo, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { useQueryClient } from '@tanstack/react-query';
import { Sparkles, LayoutTemplate, StickyNote, X as CloseIcon, ChevronDown, Hash, Repeat2, Repeat } from 'lucide-react';
import { rulesFor, validateTarget, type Issue } from '@cadence/network-rules';
import { useComposer } from './store';
import { useChannels, useMe, useTags } from '@/lib/hooks';
import { gqlRequest } from '@/lib/api';
import { M, Q } from '@/lib/queries';
import { toast } from '@/components/ui/toast';
import { Avatar, Menu, MenuItem, MenuSep, UpgradeHint } from '@/components/ui/primitives';
import { Editor } from './Editor';
import { MediaTray } from './MediaTray';
import { NetworkOptions } from './NetworkOptions';
import { SchedulePopover } from './SchedulePopover';
import { AiPanel, TemplatesPanel, HashtagPanel } from './Panels';
import { Preview } from './Preview';
import { NETWORK_LABEL } from '@/lib/format';

export function ComposerHost() {
  const s = useComposer(); const qc = useQueryClient();
  const channels = useChannels(); const me = useMe(); const tags = useTags();
  const [busy, setBusy] = useState(false); const [serverIssues, setServerIssues] = useState<Record<string, Issue[]>>({});
  const ent = me.data?.organization?.entitlements ?? {};
  const list = (channels.data?.channels ?? []).filter(c => c.status !== 'LOCKED' && c.network !== 'START_PAGE' && (c.myAccess?.publish ?? 'NONE') !== 'NONE');
  const selected = list.filter(c => s.targets[c.id]);
  const needsApproval = selected.some(c => c.myAccess?.publish === 'APPROVAL');

  // Live validation (same rules as the server)
  const issues = useMemo(() => {
    const out: Record<string, Issue[]> = {};
    for (const c of selected) {
      const t = s.targets[c.id]; const rules = rulesFor(c.network);
      const draft = { text: t.customized ? t.text : s.baseText, media: (t.customized ? t.media : s.baseMedia) as any, thread: t.thread as any, metadata: t.metadata, firstComment: t.firstComment || undefined };
      out[c.id] = validateTarget(rules, draft, { channel: { meta: c.meta ?? {}, subtype: c.subtype }, metadata: t.metadata, media: draft.media, premium: !!c.meta?.premium });
    }
    return out;
  }, [selected, s.targets, s.baseText, s.baseMedia]);
  const hasErrors = Object.values(issues).some(l => l.some(i => i.level === 'error')) || Object.values(serverIssues).some(l => l.some(i => i.level === 'error'));

  // Load an existing post for editing
  useEffect(() => { if (s.isOpen && s.postId && !s.dirty && !s.baseText && !Object.keys(s.targets).length) gqlRequest(Q.post, { id: s.postId }).then(r => s.loadPost(r.post)).catch(e => toast(e.message, { tone: 'danger' })); }, [s.isOpen, s.postId]); // eslint-disable-line react-hooks/exhaustive-deps

  const buildInput = () => ({
    baseText: s.baseText, baseMedia: s.baseMedia.map(cleanMedia), linkPreview: s.linkPreview && !s.linkPreview.removed ? { url: s.linkPreview.url, title: s.linkPreview.title, description: s.linkPreview.description, imageAssetId: s.linkPreview.imageAssetId } : null,
    targets: selected.map(c => { const t = s.targets[c.id]; return { channelId: c.id, text: t.customized ? t.text : null, media: t.customized ? t.media.map(cleanMedia) : null, thread: t.thread.length ? t.thread.map(p => ({ text: p.text, media: p.media.map(cleanMedia) })) : null, firstComment: t.firstComment || null, metadata: t.metadata, schedulingType: t.schedulingType }; }),
    mode: s.mode, dueAt: s.mode === 'CUSTOM' ? s.dueAt : null, tagIds: s.tagIds, requestApproval: s.requestApproval || needsApproval, ideaId: s.ideaId ?? null, templateId: s.templateId ?? null, aiAssisted: s.aiAssisted, autoRepost: s.autoRepost, recurrence: s.recurrence,
  });

  async function submit(mode: typeof s.mode, dueAt?: string | null) {
    if (!selected.length) return toast('Choose at least one channel', { tone: 'danger' });
    if (mode !== 'DRAFT' && hasErrors) return toast('Fix the highlighted issues first', { tone: 'danger' });
    setBusy(true);
    try {
      const input = { ...buildInput(), mode, dueAt: mode === 'CUSTOM' ? (dueAt ?? s.dueAt) : null };
      if (s.postId) await gqlRequest(M.updatePost, { id: s.postId, input: { baseText: input.baseText, baseMedia: input.baseMedia, linkPreview: input.linkPreview, targets: input.targets, tagIds: input.tagIds, mode: input.mode, dueAt: input.dueAt, autoRepost: input.autoRepost } });
      else await gqlRequest(M.createPost, { input });
      qc.invalidateQueries({ queryKey: ['targets'] }); qc.invalidateQueries({ queryKey: ['channels'] });
      toast(mode === 'DRAFT' ? 'Saved as draft' : mode === 'NOW' ? 'Publishing now…' : input.requestApproval ? 'Sent for approval' : mode === 'SHARE_NEXT' ? 'Added to the top of the queue' : 'Added to queue', { tone: 'success' });
      s.reset();
    } catch (e: any) {
      if (e.extensions?.issues) setServerIssues(e.extensions.issues);
      toast(e.message, { tone: 'danger', extensions: e.extensions });
    } finally { setBusy(false); }
  }

  const active = s.activeTab === 'base' ? null : list.find(c => c.id === s.activeTab);
  const activeTarget = active ? s.targets[active.id] : null;
  const activeRules = active ? rulesFor(active.network) : null;
  const primaryLabel = needsApproval || s.requestApproval ? 'Request approval' : s.mode === 'CUSTOM' ? 'Schedule post' : s.mode === 'NOW' ? 'Share now' : s.mode === 'SHARE_NEXT' ? 'Share next' : 'Add to queue';

  return (
    <Dialog.Root open={s.isOpen} onOpenChange={o => { if (!o) s.close(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog" aria-describedby={undefined} onEscapeKeyDown={e => { if (s.dirty) { e.preventDefault(); if (confirm('Keep this as an unfinished post? (Cancel to discard)')) s.close(); else s.reset(); } }}>
          <div className="dialog-head">
            <Dialog.Title asChild><h2>{s.postId ? 'Edit post' : 'New post'}</h2></Dialog.Title>
            <span style={{ flex: 1 }} />
            <button className={`btn ghost sm ${s.panel === 'ai' ? 'secondary' : ''}`} onClick={() => s.setPanel('ai')} aria-pressed={s.panel === 'ai'}><Sparkles size={14} /> AI Assistant</button>
            <button className={`btn ghost sm ${s.panel === 'templates' ? 'secondary' : ''}`} onClick={() => s.setPanel('templates')} aria-pressed={s.panel === 'templates'}><LayoutTemplate size={14} /> Templates</button>
            {s.postId && <button className="btn ghost sm" onClick={() => s.setPanel('notes')}><StickyNote size={14} /> Notes</button>}
            <Dialog.Close asChild><button className="btn ghost icon" aria-label="Close"><CloseIcon size={18} /></button></Dialog.Close>
          </div>
          <div className="dialog-body" style={{ position: 'relative' }}>
            <div className="composer">
              <div>
                <div className="channel-picker" role="group" aria-label="Channels">
                  {list.map(c => <button key={c.id} className="chan-toggle" aria-pressed={!!s.targets[c.id]} aria-label={`${c.displayName} (${NETWORK_LABEL[c.network]})`} title={c.displayName} onClick={() => s.toggleChannel(c.id, c.notifyByDefault)}><Avatar src={c.avatarUrl} name={c.displayName} network={c.network} /></button>)}
                  {!list.length && <span className="subtle">Connect a channel to start posting.</span>}
                </div>
                {selected.length > 0 && (
                  <div className="net-tabs" role="tablist" aria-label="Customize per network">
                    <button role="tab" className="net-tab" aria-selected={s.activeTab === 'base'} onClick={() => s.setActiveTab('base')}>Base post</button>
                    {selected.map(c => { const errs = [...(issues[c.id] ?? []), ...(serverIssues[c.id] ?? [])]; const hasErr = errs.some(i => i.level === 'error'); return <button key={c.id} role="tab" className="net-tab" aria-selected={s.activeTab === c.id} onClick={() => s.setActiveTab(c.id)}>{NETWORK_LABEL[c.network]}{selected.filter(x => x.network === c.network).length > 1 && <span className="subtle">· {c.displayName}</span>}{s.targets[c.id]?.customized && <span className="dot" aria-label="customized" />}{hasErr && <span className="err" aria-label="has errors">!</span>}</button>; })}
                  </div>
                )}
                {!active ? (
                  <>
                    <Editor value={s.baseText} onChange={s.setBaseText} media={s.baseMedia} onMedia={s.setBaseMedia} rules={null} channelMeta={{}} linkPreview={s.linkPreview} onLinkPreview={s.setLinkPreview} placeholder={selected.length ? 'What would you like to share?' : 'Start writing — pick channels when you are ready'} onAi={() => s.setPanel('ai')} onHashtags={() => s.setPanel('hashtags')} allowThreads={false} thread={[]} onThread={() => undefined} />
                    <MediaTray items={s.baseMedia} onChange={s.setBaseMedia} listen />
                    {selected.length > 0 && <p className="subtle" style={{ marginTop: 10 }}>This text goes to all selected channels. Pick a network tab to customize it.</p>}
                  </>
                ) : (
                  <>
                    {!activeTarget!.customized ? (
                      <div className="card" style={{ background: 'var(--bg-subtle)' }}>
                        <p style={{ margin: '0 0 8px' }}>{active.displayName} uses the base post.</p>
                        <button className="btn secondary sm" onClick={() => s.customize(active.id)}>Customize for {NETWORK_LABEL[active.network]}</button>
                      </div>
                    ) : (
                      <>
                        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 6 }}><span className="subtle">Customized for {active.displayName}</span><button className="btn ghost sm" onClick={() => s.uncustomize(active.id)}>Use base post</button></div>
                        <Editor value={activeTarget!.text} onChange={t => s.updateTarget(active.id, { text: t })} media={activeTarget!.media} onMedia={m => s.updateTarget(active.id, { media: m })} rules={activeRules} channelMeta={active.meta ?? {}} premium={!!active.meta?.premium} linkPreview={s.linkPreview} onLinkPreview={s.setLinkPreview} placeholder={`Write for ${NETWORK_LABEL[active.network]}…`} onAi={() => s.setPanel('ai')} onHashtags={() => s.setPanel('hashtags')} allowThreads={!!activeRules?.thread} thread={activeTarget!.thread} onThread={th => s.updateTarget(active.id, { thread: th })} />
                        <MediaTray items={activeTarget!.media} onChange={m => s.updateTarget(active.id, { media: m })} altMax={activeRules?.media.altTextMax} showCover={['INSTAGRAM', 'TIKTOK', 'PINTEREST', 'YOUTUBE'].includes(active.network)} showUserTags={active.network === 'INSTAGRAM'} listen />
                      </>
                    )}
                    <NetworkOptions channel={active} target={activeTarget!} onChange={p => s.updateTarget(active.id, p)} entitlements={ent} />
                    <IssueList issues={[...(issues[active.id] ?? []), ...(serverIssues[active.id] ?? [])]} />
                  </>
                )}
              </div>
              <aside className="preview-pane" aria-label="Preview">
                <Preview channel={active ?? selected[0] ?? null} text={active && activeTarget?.customized ? activeTarget.text : s.baseText} media={active && activeTarget?.customized ? activeTarget.media : s.baseMedia} linkPreview={s.linkPreview} thread={activeTarget?.thread ?? []} />
                {!active && selected.length > 0 && <div style={{ marginTop: 12 }}>{selected.map(c => { const errs = issues[c.id] ?? []; const e = errs.filter(i => i.level === 'error').length; return e ? <div key={c.id} className="row" style={{ fontSize: 12, color: 'var(--danger)', marginBottom: 4 }}>⚠ {c.displayName}: {e} issue{e > 1 ? 's' : ''} <button className="btn ghost sm" onClick={() => s.setActiveTab(c.id)}>Fix</button></div> : null; })}</div>}
              </aside>
            </div>
            {s.panel === 'ai' && <AiPanel onClose={() => s.setPanel(null)} network={active?.network} maxChars={activeRules ? (typeof activeRules.text.max === 'number' ? activeRules.text.max : 280) : undefined} currentText={active && activeTarget?.customized ? activeTarget.text : s.baseText} onInsert={(t, replace) => { s.markAi(); const cur = active && activeTarget?.customized ? activeTarget.text : s.baseText; const next = replace ? t : `${cur}${cur ? '\n\n' : ''}${t}`; if (active && activeTarget?.customized) s.updateTarget(active.id, { text: next }); else s.setBaseText(next); }} />}
            {s.panel === 'templates' && <TemplatesPanel onClose={() => s.setPanel(null)} onUse={body => { if (active && activeTarget?.customized) s.updateTarget(active.id, { text: body }); else s.setBaseText(body); }} />}
            {s.panel === 'hashtags' && <HashtagPanel onClose={() => s.setPanel(null)} entitled={!!ent.hashtagManager} onInsert={(tags, where) => { const add = ' ' + tags.join(' '); if (where === 'firstComment' && active) s.updateTarget(active.id, { firstComment: (activeTarget?.firstComment ?? '') + add }); else if (active && activeTarget?.customized) s.updateTarget(active.id, { text: activeTarget.text + add }); else s.setBaseText(s.baseText + add); }} />}
          </div>
          <div className="dialog-foot">
            <TagPicker tags={tags.data?.tags ?? []} value={s.tagIds} onChange={s.setTagIds} />
            {selected.some(c => ['X', 'LINKEDIN', 'BLUESKY'].includes(c.network)) && (
              <Menu trigger={<button className="btn ghost sm" title="Auto-repost this post later to extend its reach (X, LinkedIn, Bluesky)"><Repeat2 size={14} /> {s.autoRepost === 'OFF' ? 'Boost' : s.autoRepost === 'ALWAYS' ? 'Boost: Always' : 'Boost: Smart'}</button>}>
                <MenuItem onSelect={() => s.setAutoRepost('OFF')}>{s.autoRepost === 'OFF' ? '✓ ' : ''}Off — publish once</MenuItem>
                <MenuItem onSelect={() => s.setAutoRepost('SMART')}>{s.autoRepost === 'SMART' ? '✓ ' : ''}Smart — repost only if it takes off</MenuItem>
                <MenuItem onSelect={() => s.setAutoRepost('ALWAYS')}>{s.autoRepost === 'ALWAYS' ? '✓ ' : ''}Always — repost after 48h</MenuItem>
              </Menu>
            )}
            <Menu trigger={<button className="btn ghost sm" title="Repeat this post on a schedule (applies when you pick a date & time)"><Repeat size={14} /> {s.recurrence ? `Repeats ${s.recurrence.freq.toLowerCase()} ×${s.recurrence.count}` : 'Repeat'}</button>}>
              <MenuItem onSelect={() => s.setRecurrence(null)}>{!s.recurrence ? '✓ ' : ''}Does not repeat</MenuItem>
              <MenuItem onSelect={() => s.setRecurrence({ freq: 'DAILY', interval: 1, count: 5 })}>Daily · 5 times</MenuItem>
              <MenuItem onSelect={() => s.setRecurrence({ freq: 'WEEKLY', interval: 1, count: 4 })}>Weekly · 4 times</MenuItem>
              <MenuItem onSelect={() => s.setRecurrence({ freq: 'WEEKLY', interval: 1, count: 8 })}>Weekly · 8 times</MenuItem>
              <MenuItem onSelect={() => s.setRecurrence({ freq: 'MONTHLY', interval: 1, count: 3 })}>Monthly · 3 times</MenuItem>
            </Menu>
            {hasErrors && <span className="subtle" style={{ color: 'var(--danger)' }}>⚠ {Object.values(issues).flat().filter(i => i.level === 'error').length} issue(s) to fix</span>}
            <span style={{ flex: 1 }} />
            <button className="btn secondary" disabled={busy} onClick={() => submit('DRAFT')}>Save as draft</button>
            <div className="row" style={{ gap: 0 }}>
              <button className="btn primary" style={{ borderRadius: '10px 0 0 10px' }} disabled={busy || !selected.length} onClick={() => submit(needsApproval || s.requestApproval ? 'QUEUE' : s.mode)}>{busy ? 'Saving…' : primaryLabel}</button>
              <Menu trigger={<button className="btn primary icon" style={{ borderRadius: '0 10px 10px 0', borderLeft: '1px solid rgba(0,0,0,.15)' }} aria-label="More scheduling options" disabled={busy || !selected.length}><ChevronDown size={16} /></button>}>
                <MenuItem onSelect={() => submit('QUEUE')}>Add to queue</MenuItem>
                <MenuItem onSelect={() => ent.shareNext ? submit('SHARE_NEXT') : toast('Share next is available on paid plans', { extensions: { code: 'ENTITLEMENT' } })}>Share next {!ent.shareNext && <UpgradeHint feature="Share next" />}</MenuItem>
                <MenuItem onSelect={() => document.dispatchEvent(new CustomEvent('relay:schedule-popover'))}>Set date and time…</MenuItem>
                <MenuItem onSelect={() => submit('NOW')}>Share now</MenuItem>
                <MenuSep />
                {ent.approvals && <MenuItem onSelect={() => { s.setRequestApproval(true); submit('QUEUE'); }}>Request approval</MenuItem>}
                <MenuItem onSelect={() => submit('DRAFT')}>Save as draft</MenuItem>
              </Menu>
            </div>
            <SchedulePopover channels={selected} onPick={(iso) => { s.setMode('CUSTOM', iso); submit('CUSTOM', iso); }} />
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

const cleanMedia = (m: any) => ({ assetId: m.assetId, kind: m.kind, altText: m.altText || undefined, userTags: m.userTags?.length ? m.userTags : undefined, cover: m.cover, order: m.order });

function IssueList({ issues }: { issues: Issue[] }) {
  if (!issues.length) return null;
  return <ul className="issues" aria-live="polite" style={{ listStyle: 'none', padding: 0 }}>{issues.map((i, k) => <li key={k} className={i.level}>{i.level === 'error' ? '⚠' : 'ⓘ'} {i.message}</li>)}</ul>;
}

function TagPicker({ tags, value, onChange }: { tags: any[]; value: string[]; onChange: (v: string[]) => void }) {
  return (
    <Menu align="start" trigger={<button className="btn ghost sm" aria-label="Tags"><Hash size={14} /> {value.length ? tags.filter(t => value.includes(t.id)).map(t => t.name).join(', ') : 'Tags'}</button>}>
      {tags.length ? tags.map(t => <MenuItem key={t.id} onSelect={() => onChange(value.includes(t.id) ? value.filter(v => v !== t.id) : [...value, t.id])}><span style={{ width: 10, height: 10, borderRadius: 3, background: t.color, display: 'inline-block' }} /> {t.name} {value.includes(t.id) && '✓'}</MenuItem>) : <MenuItem onSelect={() => (window.location.href = '/settings/tags')}>Create tags in Settings</MenuItem>}
    </Menu>
  );
}
