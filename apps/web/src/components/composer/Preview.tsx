'use client';
import { Avatar } from '@/components/ui/primitives';
import { NETWORK_LABEL } from '@/lib/format';
import type { MediaItem, LinkPreview } from './store';

/** Lightweight per-network preview (avatar, media aspect, text). */
export function Preview({ channel, text, media, linkPreview, thread }: { channel: any | null; text: string; media: MediaItem[]; linkPreview: LinkPreview | null; thread: { text: string }[] }) {
  if (!channel) return <div className="phone"><p className="subtle" style={{ margin: 0 }}>Pick a channel to see a preview.</p></div>;
  const aspect = channel.network === 'INSTAGRAM' ? '4 / 5' : channel.network === 'TIKTOK' || channel.network === 'YOUTUBE' ? '9 / 16' : channel.network === 'PINTEREST' ? '2 / 3' : '16 / 9';
  const first = media[0];
  return (
    <div className="phone" aria-label={`${NETWORK_LABEL[channel.network]} preview`}>
      <div className="ph-head"><Avatar src={channel.avatarUrl} name={channel.displayName} network={channel.network} size="sm" /><span>{channel.displayName}</span><span className="subtle" style={{ marginLeft: 'auto', fontWeight: 400 }}>Preview</span></div>
      {first ? <div className="ph-media" style={{ aspectRatio: aspect }}>{first.kind === 'video' ? (first.thumbUrl ? <img src={first.thumbUrl} alt="" /> : '▶ Video') : first.kind === 'document' ? 'PDF document' : <img src={first.previewUrl ?? first.thumbUrl} alt="" />}{media.length > 1 && <span className="tag" style={{ position: 'absolute', margin: 8 }}>1/{media.length}</span>}</div>
        : linkPreview && !linkPreview.removed ? <div className="ph-media" style={{ aspectRatio: '1.91 / 1' }}>{linkPreview.image ? <img src={linkPreview.image} alt="" /> : linkPreview.title}</div> : null}
      <p className="ph-text">{text || <span className="subtle">Your text will appear here</span>}</p>
      {thread.map((t, i) => <p key={i} className="ph-text" style={{ borderLeft: '2px solid var(--border)', paddingLeft: 8, color: 'var(--fg-muted)' }}>{t.text || `Part ${i + 2}`}</p>)}
      <div className="row subtle" style={{ marginTop: 8, gap: 14 }}><span>♡</span><span>💬</span><span>↗</span></div>
    </div>
  );
}
