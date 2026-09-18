'use client';
import { create } from 'zustand';

export interface MediaItem { assetId: string; kind: 'image' | 'gif' | 'video' | 'document'; mime?: string; bytes?: number; width?: number; height?: number; durationMs?: number; altText?: string; thumbUrl?: string; previewUrl?: string; userTags?: any[]; cover?: { offsetMs?: number; assetId?: string }; status?: 'uploading' | 'processing' | 'ready' | 'failed'; progress?: number }
export interface TargetDraft { channelId: string; customized: boolean; text: string; media: MediaItem[]; thread: { text: string; media: MediaItem[] }[]; firstComment: string; metadata: Record<string, any>; schedulingType: 'AUTOMATIC' | 'NOTIFICATION' }
export interface LinkPreview { url: string; title?: string; description?: string; image?: string; imageAssetId?: string; siteName?: string; removed?: boolean }

export interface OpenOptions { channelIds?: string[]; postId?: string; prefill?: { text?: string; media?: MediaItem[]; url?: string; ideaId?: string; templateId?: string }; dueAt?: string; mode?: 'QUEUE' | 'SHARE_NEXT' | 'CUSTOM' | 'NOW' | 'DRAFT' }

interface ComposerState {
  isOpen: boolean; postId?: string; ideaId?: string; templateId?: string;
  baseText: string; baseMedia: MediaItem[]; linkPreview: LinkPreview | null;
  targets: Record<string, TargetDraft>; activeTab: 'base' | string;
  tagIds: string[]; mode: 'QUEUE' | 'SHARE_NEXT' | 'CUSTOM' | 'NOW' | 'DRAFT'; dueAt: string | null; requestApproval: boolean; aiAssisted: boolean;
  panel: 'ai' | 'templates' | 'notes' | 'hashtags' | null; dirty: boolean;
  open: (o: OpenOptions) => void; close: () => void; reset: () => void;
  setBaseText: (t: string) => void; setBaseMedia: (m: MediaItem[]) => void; setLinkPreview: (p: LinkPreview | null) => void;
  toggleChannel: (id: string, notifyDefault?: boolean) => void; setActiveTab: (t: string) => void;
  customize: (channelId: string) => void; uncustomize: (channelId: string) => void;
  updateTarget: (channelId: string, patch: Partial<TargetDraft>) => void;
  setTagIds: (ids: string[]) => void; setMode: (m: ComposerState['mode'], dueAt?: string | null) => void; setRequestApproval: (b: boolean) => void; setPanel: (p: ComposerState['panel']) => void; markAi: () => void;
  loadPost: (post: any) => void;
}

const DRAFT_KEY = 'relay.composer.draft';
const emptyTarget = (channelId: string, notify = false): TargetDraft => ({ channelId, customized: false, text: '', media: [], thread: [], firstComment: '', metadata: {}, schedulingType: notify ? 'NOTIFICATION' : 'AUTOMATIC' });

export const useComposer = create<ComposerState>((set, get) => ({
  isOpen: false, baseText: '', baseMedia: [], linkPreview: null, targets: {}, activeTab: 'base', tagIds: [], mode: 'QUEUE', dueAt: null, requestApproval: false, aiAssisted: false, panel: null, dirty: false,
  open: o => {
    const saved = !o.postId && !o.prefill ? loadDraft() : null;
    if (saved) { set({ ...saved, isOpen: true }); return; }
    const targets: Record<string, TargetDraft> = {};
    for (const id of o.channelIds ?? []) targets[id] = emptyTarget(id);
    set({ isOpen: true, postId: o.postId, ideaId: o.prefill?.ideaId, templateId: o.prefill?.templateId, baseText: o.prefill?.text ?? (o.prefill?.url ? `\n${o.prefill.url}` : ''), baseMedia: o.prefill?.media ?? [], linkPreview: null, targets, activeTab: 'base', tagIds: [], mode: o.mode ?? (o.dueAt ? 'CUSTOM' : 'QUEUE'), dueAt: o.dueAt ?? null, requestApproval: false, aiAssisted: false, panel: null, dirty: !!o.prefill });
  },
  close: () => { if (get().dirty && !get().postId) saveDraft(get()); else clearDraft(); set({ isOpen: false }); },
  reset: () => { clearDraft(); set({ isOpen: false, postId: undefined, ideaId: undefined, baseText: '', baseMedia: [], linkPreview: null, targets: {}, activeTab: 'base', tagIds: [], mode: 'QUEUE', dueAt: null, requestApproval: false, aiAssisted: false, panel: null, dirty: false }); },
  setBaseText: t => set({ baseText: t, dirty: true }),
  setBaseMedia: m => set({ baseMedia: m, dirty: true }),
  setLinkPreview: p => set({ linkPreview: p, dirty: true }),
  toggleChannel: (id, notifyDefault) => set(s => { const t = { ...s.targets }; if (t[id]) { delete t[id]; } else t[id] = emptyTarget(id, notifyDefault); return { targets: t, dirty: true, activeTab: s.activeTab in t || s.activeTab === 'base' ? s.activeTab : 'base' }; }),
  setActiveTab: t => set({ activeTab: t }),
  customize: id => set(s => ({ targets: { ...s.targets, [id]: { ...s.targets[id], customized: true, text: s.baseText, media: s.baseMedia } }, activeTab: id, dirty: true })),
  uncustomize: id => set(s => ({ targets: { ...s.targets, [id]: { ...s.targets[id], customized: false, text: '', media: [], thread: [] } }, dirty: true })),
  updateTarget: (id, patch) => set(s => ({ targets: { ...s.targets, [id]: { ...s.targets[id], ...patch } }, dirty: true })),
  setTagIds: ids => set({ tagIds: ids, dirty: true }),
  setMode: (mode, dueAt) => set({ mode, dueAt: dueAt ?? null }),
  setRequestApproval: b => set({ requestApproval: b }),
  setPanel: p => set(s => ({ panel: s.panel === p ? null : p })),
  markAi: () => set({ aiAssisted: true }),
  loadPost: post => {
    const targets: Record<string, TargetDraft> = {};
    for (const t of post.targets) targets[t.channelId] = { channelId: t.channelId, customized: t.customized, text: t.customized ? t.text : '', media: t.customized ? t.media : [], thread: t.thread ?? [], firstComment: t.firstComment ?? '', metadata: t.metadata ?? {}, schedulingType: t.schedulingType };
    const first = post.targets[0];
    set({ isOpen: true, postId: post.id, baseText: post.baseText, baseMedia: post.baseMedia ?? [], linkPreview: post.linkPreview ?? null, targets, activeTab: 'base', tagIds: (post.tags ?? []).map((t: any) => t.id), mode: first?.isCustomTime ? 'CUSTOM' : post.scheduleMode === 'DRAFT' ? 'DRAFT' : 'QUEUE', dueAt: first?.isCustomTime ? first.dueAt : null, requestApproval: false, aiAssisted: post.aiAssisted, panel: null, dirty: false });
  },
}));

function saveDraft(s: ComposerState) { try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ baseText: s.baseText, baseMedia: s.baseMedia, linkPreview: s.linkPreview, targets: s.targets, tagIds: s.tagIds, mode: s.mode, dueAt: s.dueAt, dirty: true, activeTab: 'base', panel: null, requestApproval: s.requestApproval, aiAssisted: s.aiAssisted, savedAt: Date.now() })); } catch { /* ignore */ } }
function loadDraft(): Partial<ComposerState> | null { try { const raw = localStorage.getItem(DRAFT_KEY); if (!raw) return null; const d = JSON.parse(raw); if (Date.now() - d.savedAt > 7 * 864e5 || (!d.baseText && !d.baseMedia?.length)) { clearDraft(); return null; } return d; } catch { return null; } }
export function clearDraft() { try { localStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ } }
export const hasSavedDraft = () => !!loadDraft();
