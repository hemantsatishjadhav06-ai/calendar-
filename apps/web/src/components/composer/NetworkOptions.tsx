'use client';
import { useEffect, useState } from 'react';
import { rulesFor } from '@cadence/network-rules';
import type { TargetDraft } from './store';
import { gqlRequest } from '@/lib/api';
import { Q } from '@/lib/queries';
import { UpgradeHint } from '@/components/ui/primitives';

/** Per-network fields under the editor (Buffer parity list in blueprint §1.4). */
export function NetworkOptions({ channel, target, onChange, entitlements }: { channel: any; target: TargetDraft; onChange: (p: Partial<TargetDraft>) => void; entitlements: any }) {
  const rules = rulesFor(channel.network); const md = target.metadata; const set = (k: string, v: any) => onChange({ metadata: { ...md, [k]: v } });
  const [lookup, setLookup] = useState<any>(null);
  useEffect(() => {
    const what = channel.network === 'PINTEREST' ? 'boards' : channel.network === 'TIKTOK' ? 'creatorInfo' : null;
    if (what) gqlRequest(Q.channelLookup, { channelId: channel.id, what }).then(r => setLookup(r.channelLookup)).catch(() => setLookup(null));
  }, [channel.id, channel.network]);

  return (
    <div className="options" aria-label={`${channel.displayName} options`}>
      {rules.postTypes && <div className="field"><span className="group-label">Post type</span><div className="tabs" role="radiogroup" aria-label="Post type">{rules.postTypes.map(p =><button key={p.id} role="radio" aria-checked={(md.postType ?? rules.postTypes![0].id) === p.id} className="tab" style={{ border: '1px solid var(--border)', background: (md.postType ?? rules.postTypes![0].id) === p.id ? 'var(--bg-inset)' : 'none', cursor: 'pointer' }} onClick={() => set('postType', p.id)}>{p.label}</button>)}</div></div>}

      {channel.network === 'INSTAGRAM' && <>
        {md.postType === 'reel' && <Toggle label="Also share to feed" checked={md.shareToFeed !== false} onChange={v => set('shareToFeed', v)} />}
        {md.postType !== 'story' && <Field label="Location (Facebook Place ID)" value={md.locationId ?? ''} onChange={v => set('locationId', v)} hint="Search a place in Facebook and paste its ID" />}
        {md.postType !== 'story' && <Field label="Collaborators (up to 3 usernames)" value={(md.collaborators ?? []).join(', ')} onChange={v => set('collaborators', v.split(',').map(s => s.trim().replace(/^@/, '')).filter(Boolean).slice(0, 3))} />}
        {md.postType !== 'story' && <Field id="f-shop-grid-link" label={<>Shop Grid link {!entitlements.shopGrid && <UpgradeHint feature="Shop Grid" />}</>} value={md.shopGridLink ?? ''} onChange={v => set('shopGridLink', v)} disabled={!entitlements.shopGrid} placeholder="https://" />}
      </>}
      {channel.network === 'FACEBOOK' && md.postType !== 'story' && <Field label="Video title (optional)" value={md.title ?? ''} onChange={v => set('title', v)} />}
      {channel.network === 'THREADS' && <>
        <Field label="Topic tag (one)" value={md.topicTag ?? ''} onChange={v => set('topicTag', v.replace(/^#/, ''))} placeholder="photography" />
        <Select label="Who can reply" value={md.replyControl ?? 'everyone'} onChange={v => set('replyControl', v)} options={[['everyone', 'Everyone'], ['accounts_you_follow', 'Accounts you follow'], ['mentioned_only', 'Mentioned only'], ['followers_only', 'Followers only']]} />
      </>}
      {channel.network === 'X' && <>
        <Select label="Who can reply" value={md.replySettings ?? 'everyone'} onChange={v => set('replySettings', v)} options={[['everyone', 'Everyone'], ['following', 'Accounts you follow'], ['mentionedUsers', 'Only mentioned'], ['subscribers', 'Subscribers'], ['verified', 'Verified accounts']]} />
        <PollEditor md={md} set={set} maxOpt={25} />
        {/https?:\/\//.test(target.text) && <p className="hint" style={{ color: 'var(--warning)' }}>ⓘ X charges more for posts containing a link ($0.20 vs $0.015).</p>}
      </>}
      {channel.network === 'LINKEDIN' && <>
        <Select label="Visibility" value={md.visibility ?? 'PUBLIC'} onChange={v => set('visibility', v)} options={[['PUBLIC', 'Anyone'], ['CONNECTIONS', 'Connections only'], ['LOGGED_IN', 'Signed-in members']]} />
        {target.media.some(m => m.kind === 'document') && <Field label="Document title (required)" value={md.document?.title ?? ''} onChange={v => set('document', { title: v })} />}
        {target.media.some(m => m.kind === 'video') && <Field label="Video title" value={md.title ?? ''} onChange={v => set('title', v)} />}
        <PollEditor md={md} set={set} maxOpt={30} durations={[['ONE_DAY', '1 day'], ['THREE_DAYS', '3 days'], ['SEVEN_DAYS', '7 days'], ['FOURTEEN_DAYS', '14 days']]} />
        <Toggle label="Disable resharing" checked={!!md.disableReshare} onChange={v => set('disableReshare', v)} />
      </>}
      {channel.network === 'TIKTOK' && <>
        {lookup && <p className="hint">Posting as <b>{lookup.creator_nickname}</b>. Max video length for this account: {lookup.max_video_post_duration_sec}s.</p>}
        <Select label="Who can view this post" value={md.privacyLevel ?? ''} onChange={v => set('privacyLevel', v)} options={[['', 'Choose…'], ...((lookup?.privacy_level_options ?? ['PUBLIC_TO_EVERYONE', 'MUTUAL_FOLLOW_FRIENDS', 'FOLLOWER_OF_CREATOR', 'SELF_ONLY']) as string[]).map(o => [o, ({ PUBLIC_TO_EVERYONE: 'Everyone', MUTUAL_FOLLOW_FRIENDS: 'Friends', FOLLOWER_OF_CREATOR: 'Followers', SELF_ONLY: 'Only me' } as any)[o] ?? o] as [string, string])]} />
        <div className="row" style={{ gap: 16, flexWrap: 'wrap' }}>
          <Toggle label="Allow comments" checked={!md.disableComment} onChange={v => set('disableComment', !v)} disabled={lookup?.comment_disabled} />
          <Toggle label="Allow Duet" checked={!md.disableDuet} onChange={v => set('disableDuet', !v)} disabled={lookup?.duet_disabled} />
          <Toggle label="Allow Stitch" checked={!md.disableStitch} onChange={v => set('disableStitch', !v)} disabled={lookup?.stitch_disabled} />
        </div>
        <Toggle label="Disclose commercial content" checked={!!md.brandContent || !!md.brandOrganic} onChange={v => { set('brandOrganic', v); if (!v) set('brandContent', false); }} />
        {(md.brandContent || md.brandOrganic) && <div className="row" style={{ gap: 16 }}><Toggle label="Your brand" checked={!!md.brandOrganic} onChange={v => set('brandOrganic', v)} /><Toggle label="Branded content (paid partnership)" checked={!!md.brandContent} onChange={v => set('brandContent', v)} /></div>}
        <p className="hint">By posting, you agree to TikTok's <a href="https://www.tiktok.com/legal/page/global/music-usage-confirmation/en" target="_blank" rel="noreferrer">Music Usage Confirmation</a>{md.brandContent ? " and Branded Content Policy" : ''}.</p>
        <Toggle label="AI-generated content" checked={!!md.aiGenerated} onChange={v => set('aiGenerated', v)} />
      </>}
      {channel.network === 'YOUTUBE' && <>
        <Field label="Title (required, max 100)" value={md.title ?? ''} onChange={v => set('title', v.slice(0, 100))} />
        <Select label="Visibility" value={md.privacyStatus ?? 'public'} onChange={v => set('privacyStatus', v)} options={[['public', 'Public'], ['unlisted', 'Unlisted'], ['private', 'Private']]} />
        <Toggle label="Made for kids" checked={!!md.madeForKids} onChange={v => set('madeForKids', v)} />
        <Toggle label="Notify subscribers" checked={md.notifySubscribers !== false} onChange={v => set('notifySubscribers', v)} />
      </>}
      {channel.network === 'PINTEREST' && <>
        <Select label="Board (required)" value={md.boardId ?? ''} onChange={v => set('boardId', v)} options={[['', 'Choose a board…'], ...((lookup ?? []) as any[]).map(b => [b.id, `${b.name}${b.privacy === 'SECRET' ? ' 🔒' : ''}`] as [string, string])]} />
        <Field label="Title (max 100)" value={md.title ?? ''} onChange={v => set('title', v.slice(0, 100))} />
        <Field label="Destination link" value={md.link ?? ''} onChange={v => set('link', v)} placeholder="https://" hint="Not shortened — Pinterest flags shorteners." />
      </>}
      {channel.network === 'GOOGLE_BUSINESS' && <>
        <Select label="Post type" value={md.topicType ?? 'STANDARD'} onChange={v => set('topicType', v)} options={[['STANDARD', "What's new"], ['EVENT', 'Event'], ['OFFER', 'Offer']]} />
        {(md.topicType === 'EVENT' || md.topicType === 'OFFER') && <div className="grid" style={{ gridTemplateColumns: '1fr 1fr' }}><Field label="Title (max 58)" value={md.event?.title ?? ''} onChange={v => set('event', { ...(md.event ?? {}), title: v.slice(0, 58) })} /><span /><Field label="Starts" type="datetime-local" value={md.event?.start?.slice(0, 16) ?? ''} onChange={v => set('event', { ...(md.event ?? {}), start: new Date(v).toISOString() })} /><Field label="Ends" type="datetime-local" value={md.event?.end?.slice(0, 16) ?? ''} onChange={v => set('event', { ...(md.event ?? {}), end: new Date(v).toISOString() })} /></div>}
        {md.topicType === 'OFFER' && <><Field label="Coupon code" value={md.offer?.couponCode ?? ''} onChange={v => set('offer', { ...(md.offer ?? {}), couponCode: v })} /><Field label="Redeem online URL" value={md.offer?.redeemOnlineUrl ?? ''} onChange={v => set('offer', { ...(md.offer ?? {}), redeemOnlineUrl: v })} /></>}
        {md.topicType !== 'OFFER' && <div className="grid" style={{ gridTemplateColumns: '1fr 2fr' }}><Select label="Button" value={md.cta?.actionType ?? 'NONE'} onChange={v => set('cta', { ...(md.cta ?? {}), actionType: v })} options={[['NONE', 'None'], ['BOOK', 'Book'], ['ORDER', 'Order online'], ['SHOP', 'Buy'], ['LEARN_MORE', 'Learn more'], ['SIGN_UP', 'Sign up'], ['CALL', 'Call now']]} />{md.cta?.actionType && !['NONE', 'CALL'].includes(md.cta.actionType) && <Field label="Button link" value={md.cta?.url ?? ''} onChange={v => set('cta', { ...(md.cta ?? {}), url: v })} placeholder="https://" />}</div>}
      </>}
      {channel.network === 'BLUESKY' && <Select label="Who can reply" value={md.replyControl ?? 'everyone'} onChange={v => set('replyControl', v)} options={[['everyone', 'Everyone'], ['mention', 'Mentioned users'], ['following', 'Users you follow'], ['follower', 'Your followers'], ['nobody', 'Nobody']]} />}
      {channel.network === 'MASTODON' && <>
        <Select label="Visibility" value={md.visibility ?? 'public'} onChange={v => set('visibility', v)} options={[['public', 'Public'], ['unlisted', 'Unlisted'], ['private', 'Followers only'], ['direct', 'Mentioned only']]} />
        <Field label="Content warning (optional)" value={md.spoilerText ?? ''} onChange={v => set('spoilerText', v)} />
        <PollEditor md={md} set={set} maxOpt={50} />
      </>}

      {rules.features.firstComment && <div className="field"><label htmlFor="fc">First comment {!entitlements.firstComment && <UpgradeHint feature="First comment" />}</label><textarea id="fc" className="textarea" style={{ minHeight: 60 }} disabled={!entitlements.firstComment} value={target.firstComment} onChange={e => onChange({ firstComment: e.target.value })} placeholder="Posted as the first comment right after publishing — great for hashtags" /></div>}
      {rules.features.notifyMe && <div className="field"><span className="group-label">Publishing</span><div className="tabs" role="radiogroup" aria-label="Publishing"><button role="radio" aria-checked={target.schedulingType === 'AUTOMATIC'} className="tab" style={{ border: '1px solid var(--border)', background: target.schedulingType === 'AUTOMATIC' ? 'var(--bg-inset)' : 'none', cursor: 'pointer' }} onClick={() => onChange({ schedulingType: 'AUTOMATIC' })}>Automatic</button><button role="radio" aria-checked={target.schedulingType === 'NOTIFICATION'} className="tab" style={{ border: '1px solid var(--border)', background: target.schedulingType === 'NOTIFICATION' ? 'var(--bg-inset)' : 'none', cursor: 'pointer' }} onClick={() => onChange({ schedulingType: 'NOTIFICATION' })}>📱 Notify me</button></div><span className="hint">Notify me sends you a reminder to finish the post in the app — needed for music, stickers, product tags and Facebook Groups.</span></div>}
    </div>
  );
}

const Field = ({ label, value, onChange, hint, placeholder, disabled, type = 'text', id: givenId }: { label: React.ReactNode; value: string; onChange: (v: string) => void; hint?: string; placeholder?: string; disabled?: boolean; type?: string; id?: string }) => { const id = givenId ?? `f-${(typeof label === 'string' ? label : 'field-' + Math.random().toString(36).slice(2, 6)).replace(/\W+/g, '-').toLowerCase()}`; return <div className="field"><label htmlFor={id}>{label}</label><input id={id} className="input" type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} disabled={disabled} />{hint && <span className="hint">{hint}</span>}</div>; };
const Select = ({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: [string, string][] }) => { const id = `s-${label.replace(/\W+/g, '-').toLowerCase()}`; return <div className="field"><label htmlFor={id}>{label}</label><select id={id} className="select" value={value} onChange={e => onChange(e.target.value)}>{options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>; };
const Toggle = ({ label, checked, onChange, disabled }: { label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) => <label className="row" style={{ fontSize: 13, opacity: disabled ? .5 : 1 }}><input type="checkbox" checked={checked} disabled={disabled} onChange={e => onChange(e.target.checked)} /> {label}</label>;
function PollEditor({ md, set, maxOpt, durations }: { md: any; set: (k: string, v: any) => void; maxOpt: number; durations?: [string, string][] }) {
  const poll = md.poll;
  if (!poll) return <button className="btn ghost sm" onClick={() => set('poll', { options: ['', ''], ...(durations ? { duration: 'SEVEN_DAYS' } : { durationMinutes: 1440, expiresInSec: 86400 }) })}>+ Add poll</button>;
  return (
    <div className="card" style={{ padding: 10 }}>
      <div className="row" style={{ justifyContent: 'space-between' }}><b style={{ fontSize: 13 }}>Poll</b><button className="btn ghost sm" onClick={() => set('poll', undefined)}>Remove</button></div>
      {durations && <Field label="Question" value={poll.question ?? ''} onChange={v => set('poll', { ...poll, question: v.slice(0, 140) })} />}
      {poll.options.map((o: string, i: number) => <input key={i} className="input" style={{ marginTop: 6 }} value={o} maxLength={maxOpt} aria-label={`Option ${i + 1}`} placeholder={`Option ${i + 1}`} onChange={e => set('poll', { ...poll, options: poll.options.map((x: string, k: number) => (k === i ? e.target.value : x)) })} />)}
      <div className="row" style={{ marginTop: 6 }}>{poll.options.length < 4 && <button className="btn ghost sm" onClick={() => set('poll', { ...poll, options: [...poll.options, ''] })}>+ Option</button>}{durations ? <select className="select" style={{ width: 'auto' }} value={poll.duration} onChange={e => set('poll', { ...poll, duration: e.target.value })}>{durations.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select> : <select className="select" style={{ width: 'auto' }} value={poll.durationMinutes ?? 1440} onChange={e => set('poll', { ...poll, durationMinutes: Number(e.target.value), expiresInSec: Number(e.target.value) * 60 })}>{[[60, '1 hour'], [360, '6 hours'], [1440, '1 day'], [4320, '3 days'], [10080, '7 days']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>}</div>
    </div>
  );
}
