import type { Issue, NetworkRules, RuleCtx, TargetDraft } from './types.js';
import { countHashtags, countMentions, countUrls } from './counters.js';

const ext = (m: { mime?: string }) => (m.mime ?? '').split('/')[1]?.replace('quicktime', 'mov').replace('jpg', 'jpeg') ?? '';

/** Shared between the composer (live) and the API/worker (authoritative). */
export function validateTarget(rules: NetworkRules, t: TargetDraft, ctx: RuleCtx): Issue[] {
  const issues: Issue[] = [];
  const err = (field: string, message: string) => issues.push({ level: 'error', field, message });
  const warn = (field: string, message: string) => issues.push({ level: 'warn', field, message });

  const max = typeof rules.text.max === 'function' ? rules.text.max(ctx) : rules.text.max;
  const parts = [{ text: t.text, media: t.media }, ...(t.thread ?? [])];

  if ((t.thread?.length ?? 0) > 0 && !rules.thread) err('thread', `${rules.label} does not support threads`);
  if (rules.thread && parts.length > rules.thread.maxParts) err('thread', `Maximum ${rules.thread.maxParts} parts in a thread`);

  parts.forEach((p, i) => {
    const n = rules.text.counter(p.text ?? '', ctx);
    if (n > max) err(`text.${i}`, `${n - max} character${n - max === 1 ? '' : 's'} over the ${max} limit`);
    if (rules.text.required && !p.text?.trim() && i === 0) err('text.0', `${rules.label} requires text`);
    if (!p.text?.trim() && p.media.length === 0 && !(i === 0 && ctx.metadata?.poll)) err(`text.${i}`, 'Add text or media');

    const imgs = p.media.filter(m => m.kind === 'image' || m.kind === 'gif');
    const vids = p.media.filter(m => m.kind === 'video');
    const docs = p.media.filter(m => m.kind === 'document');
    if (imgs.length > rules.media.maxImages) err(`media.${i}`, `Maximum ${rules.media.maxImages} image${rules.media.maxImages === 1 ? '' : 's'}`);
    if (vids.length > rules.media.maxVideos) err(`media.${i}`, rules.media.maxVideos === 0 ? `${rules.label} does not accept video here` : `Maximum ${rules.media.maxVideos} video`);
    if (imgs.length && vids.length && !rules.media.mixImagesVideo) err(`media.${i}`, 'Images and video cannot be combined in one post');
    if (docs.length && !rules.media.document) err(`media.${i}`, `${rules.label} does not accept documents`);
    if (docs.length > 1) err(`media.${i}`, 'Only one document per post');
    if (p.media.some(m => m.kind === 'gif') && !rules.media.gif) warn(`media.${i}`, 'GIFs are not supported here and will be posted as a static image or video');

    for (const m of imgs) {
      if (m.bytes && m.bytes > rules.media.image.maxBytes && !m.renditionKey) warn(`media.${i}`, `Image will be compressed to under ${Math.round(rules.media.image.maxBytes / 1e6 * 10) / 10} MB`);
      if (rules.media.image.aspect && m.width && m.height) {
        const r = m.width / m.height;
        if (r < rules.media.image.aspect[0] - 0.01 || r > rules.media.image.aspect[1] + 0.01) warn(`media.${i}`, `${rules.label} shows ${rules.media.image.aspect[0] === 0.8 ? '4:5' : rules.media.image.aspect[0]} to ${rules.media.image.aspect[1]} aspect ratios; this image will be cropped`);
      }
      if (rules.media.image.minW && m.width && m.width < rules.media.image.minW) err(`media.${i}`, `Image must be at least ${rules.media.image.minW}px wide`);
      if (rules.media.image.formats.length && ext(m) && !rules.media.image.formats.includes(ext(m)) && !m.renditionKey) warn(`media.${i}`, `${ext(m).toUpperCase()} will be converted to ${rules.media.image.formats[0].toUpperCase()}`);
    }
    for (const v of vids) {
      if (!rules.media.video) { err(`media.${i}`, `${rules.label} does not accept video`); continue; }
      const maxS = typeof rules.media.video.maxS === 'function' ? rules.media.video.maxS(ctx) : rules.media.video.maxS;
      const s = (v.durationMs ?? 0) / 1000;
      if (v.durationMs != null && (s < rules.media.video.minS || s > maxS)) err(`media.${i}`, `Video must be between ${rules.media.video.minS}s and ${maxS >= 60 ? `${Math.round(maxS / 60)} min` : `${maxS}s`}`);
      if (v.bytes && v.bytes > rules.media.video.maxBytes) err(`media.${i}`, `Video must be under ${Math.round(rules.media.video.maxBytes / 1e6)} MB`);
      if (rules.media.video.aspect && v.width && v.height) { const r = v.width / v.height; if (r < rules.media.video.aspect[0] || r > rules.media.video.aspect[1]) err(`media.${i}`, `Video aspect ratio not supported by ${rules.label}`); }
    }
    for (const d of docs) if (rules.media.document && d.bytes && d.bytes > rules.media.document.maxBytes) err(`media.${i}`, `Document must be under ${Math.round(rules.media.document.maxBytes / 1e6)} MB`);
    for (const m of p.media) if (m.altText && rules.media.altTextMax && Array.from(m.altText).length > rules.media.altTextMax) err(`alt.${i}`, `Alt text max ${rules.media.altTextMax} characters on ${rules.label}`);
  });

  if (rules.media.requireMedia && t.media.length === 0) err('media.0', `${rules.label} requires an image or video`);
  if (rules.text.hashtagsMax && countHashtags(t.text) > rules.text.hashtagsMax) err('text.0', `Maximum ${rules.text.hashtagsMax} hashtags`);
  if (rules.text.mentionsMax && countMentions(t.text) > rules.text.mentionsMax) err('text.0', `Maximum ${rules.text.mentionsMax} mentions`);
  if (rules.text.linksMax && countUrls(t.text) > rules.text.linksMax) err('text.0', `Maximum ${rules.text.linksMax} links`);
  if (t.firstComment && !rules.features.firstComment) warn('firstComment', `First comment is not available on ${rules.label} and will be skipped`);
  if (t.firstComment && rules.text.hashtagsMax && countHashtags(t.text) + countHashtags(t.firstComment) > rules.text.hashtagsMax) err('firstComment', `Caption and first comment together exceed ${rules.text.hashtagsMax} hashtags`);
  if (t.metadata?.poll && t.media.length) err('metadata.poll', 'Polls cannot be combined with media');
  if (t.metadata?.poll && !rules.features.polls) err('metadata.poll', `${rules.label} does not support polls`);

  const md = rules.metadataSchema.safeParse(t.metadata ?? {});
  if (!md.success) for (const e of md.error.issues) err(`metadata.${e.path.join('.')}`, e.message);

  if (rules.postTypes) {
    const id = t.metadata?.postType ?? rules.postTypes[0].id;
    const pt = rules.postTypes.find(x => x.id === id);
    if (!pt) err('metadata.postType', 'Unknown post type');
    else {
      if (pt.count && (t.media.length < pt.count[0] || t.media.length > pt.count[1])) err('media.0', pt.count[0] === pt.count[1] ? `${pt.label} needs exactly ${pt.count[0]} media item` : `${pt.label} needs ${pt.count[0]}–${pt.count[1]} media items`);
      if (pt.media === 'video' && t.media.some(m => m.kind !== 'video')) err('media.0', `${pt.label} must be a video`);
      if (pt.media === 'image' && t.media.some(m => m.kind !== 'image')) err('media.0', `${pt.label} must be an image`);
    }
  }
  if (rules.features.title?.required && !t.metadata?.title?.trim()) err('metadata.title', `${rules.label} requires a title`);
  return issues;
}

export const hasErrors = (issues: Issue[]) => issues.some(i => i.level === 'error');
