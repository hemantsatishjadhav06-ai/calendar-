'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { TopBar } from '@/components/shell/TopBar';
import { useAccount, useChannels, useGql, useMe, useMutate, useTags, Q, M } from '@/lib/hooks';
import { rest } from '@/lib/api';
import { Avatar, Confirm, Modal, UpgradeHint } from '@/components/ui/primitives';
import { toast } from '@/components/ui/toast';
import { tzList, fmtDateTime } from '@/lib/format';
import { useQueryClient } from '@tanstack/react-query';

const SECTIONS = [['account', 'Account'], ['security', 'Security & 2FA'], ['preferences', 'Preferences'], ['notifications', 'Notifications'], ['organization', 'Organization'], ['team', 'Team members'], ['tags', 'Tags'], ['saved-replies', 'Saved replies'], ['integrations', 'Apps & extras'], ['api', 'API'], ['audit', 'Activity log']];

const ADMIN_ONLY = new Set(['team', 'audit', 'organization']);

export default function SettingsPage() {
  const { section } = useParams<{ section?: string[] }>(); const s = section?.[0] ?? 'account';
  const account = useAccount(); const role = account.data?.organizations?.find((o: any) => o.id === account.data?.currentOrganizationId)?.role ?? 'MEMBER';
  const visible = SECTIONS.filter(([k]) => role !== 'MEMBER' || !ADMIN_ONLY.has(k));
  return (
    <>
      <TopBar title="Settings" />
      <main className="content" id="main"><div className="settings">
        <nav className="settings-nav" aria-label="Settings sections">{visible.map(([k, l]) => <Link key={k} className="nav-item" href={`/settings/${k}`} aria-current={s === k ? 'page' : undefined}>{l}</Link>)}</nav>
        <div>{{ account: <Account />, security: <Security />, preferences: <Preferences />, notifications: <Notifications />, organization: <Organization />, team: <Team />, tags: <Tags />, 'saved-replies': <SavedReplies />, integrations: <Integrations />, api: <Api />, audit: <Audit /> }[s] ?? <Account />}</div>
      </div></main>
    </>
  );
}

function Section({ title, children, desc }: { title: string; children: React.ReactNode; desc?: string }) { return <section className="card" style={{ marginBottom: 16 }} aria-labelledby={title}><h2 id={title} style={{ marginTop: 0, fontSize: 16 }}>{title}</h2>{desc && <p className="subtle" style={{ marginTop: -6 }}>{desc}</p>}{children}</section>; }

function Account() {
  const a = useAccount(); const save = useMutate(M.updatePreferences, { invalidate: [['account']], success: 'Saved' });
  const [name, setName] = useState(''); useEffect(() => setName(a.data?.name ?? ''), [a.data]);
  return (<><Section title="Profile"><div className="field"><label htmlFor="name">Name</label><input id="name" className="input" value={name} onChange={e => setName(e.target.value)} onBlur={() => name !== a.data?.name && save.mutate({ input: { name } })} /></div><div className="field"><label>Email</label><input className="input" value={a.data?.email ?? ''} disabled /><span className="hint">Contact support to change your sign-in email.</span></div></Section>
    <Section title="Delete account" desc="Removes your account. Organizations you own must be transferred or deleted first."><button className="btn danger sm" onClick={() => toast('Contact support to delete your account (compliance hold).')}>Delete my account</button></Section></>);
}

function Security() {
  const a = useAccount(); const qc = useQueryClient(); const [setup, setSetup] = useState<{ secret: string; otpauth: string } | null>(null); const [code, setCode] = useState(''); const [codes, setCodes] = useState<string[] | null>(null);
  return (<Section title="Two-factor authentication" desc="Adds a 6-digit code from an authenticator app to your sign-in.">
    {a.data?.totpEnabled ? <div className="row"><span className="tag brand">Enabled</span><button className="btn secondary sm" onClick={async () => { const c = prompt('Enter a current code to disable 2FA'); if (c) { await rest('/auth/totp/disable', { method: 'POST', json: { code: c } }); qc.invalidateQueries({ queryKey: ['account'] }); toast('2FA disabled'); } }}>Disable</button></div>
      : setup ? <div className="stack"><p>Scan this in your authenticator app, or enter the key manually: <code>{setup.secret}</code></p><img alt="QR code for authenticator app" src={`https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(setup.otpauth)}`} width={180} height={180} /><div className="row"><input className="input" style={{ width: 160 }} inputMode="numeric" placeholder="123456" value={code} onChange={e => setCode(e.target.value)} aria-label="Code" /><button className="btn primary sm" onClick={async () => { try { const r = await rest('/auth/totp/confirm', { method: 'POST', json: { code } }); setCodes(r.recoveryCodes); setSetup(null); qc.invalidateQueries({ queryKey: ['account'] }); } catch (e: any) { toast(e.message, { tone: 'danger' }); } }}>Confirm</button></div></div>
      : <button className="btn primary sm" onClick={async () => setSetup(await rest('/auth/totp/begin', { method: 'POST' }))}>Set up 2FA</button>}
    {codes && <Modal open onOpenChange={() => setCodes(null)} title="Recovery codes" size="sm"><p>Store these somewhere safe. Each works once if you lose your authenticator.</p><pre className="ai-out">{codes.join('\n')}</pre></Modal>}
  </Section>);
}

function Preferences() {
  const a = useAccount(); const save = useMutate(M.updatePreferences, { invalidate: [['account']], success: 'Saved' }); const p = a.data?.preferences ?? {};
  const set = (k: string, v: any) => { save.mutate({ input: { [k]: v } }); if (k === 'appearance') { const dark = v === 'dark' || (v === 'system' && matchMedia('(prefers-color-scheme: dark)').matches); document.documentElement.dataset.theme = dark ? 'dark' : 'light'; localStorage.setItem('relay.theme', v); } };
  return (<Section title="Preferences">
    <div className="field"><label htmlFor="tz">Timezone for notifications</label><select id="tz" className="select" value={a.data?.timezone ?? 'UTC'} onChange={e => set('timezone', e.target.value)}>{tzList().map(z => <option key={z} value={z}>{z.replace(/_/g, ' ')}</option>)}</select></div>
    <div className="field"><label htmlFor="ws">Start of week</label><select id="ws" className="select" value={p.weekStartsOn ?? 1} onChange={e => set('weekStartsOn', Number(e.target.value))}><option value={1}>Monday</option><option value={0}>Sunday</option></select></div>
    <div className="field"><label htmlFor="lp">Default landing page</label><select id="lp" className="select" value={p.landingPage ?? 'home'} onChange={e => set('landingPage', e.target.value)}><option value="home">Home</option><option value="publish">Publish</option></select></div>
    <div className="field"><label htmlFor="da">Default scheduling action</label><select id="da" className="select" value={p.defaultScheduleAction ?? 'queue'} onChange={e => set('defaultScheduleAction', e.target.value)}><option value="queue">Add to queue</option><option value="shareNext">Share next</option><option value="custom">Set date and time</option><option value="now">Share now</option><option value="draft">Save as draft</option></select></div>
    <div className="field"><label htmlFor="ap">Appearance</label><select id="ap" className="select" value={p.appearance ?? 'system'} onChange={e => set('appearance', e.target.value)}><option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option></select></div>
  </Section>);
}

function Notifications() {
  const prefs = useGql<any>(['prefs'], Q.notificationPrefs); const set = useMutate(M.setNotificationPref, { invalidate: [['prefs']] });
  const keys: [string, string, string][] = [['post_published', 'Published post confirmations', 'An email each time a post goes live'], ['post_failed', 'Failed posts', 'When a post could not be published'], ['channel_connection', 'Channel connection updates', 'When a channel needs to be reconnected'], ['empty_queue', 'Empty queue alerts', 'A daily nudge when a channel has nothing scheduled'], ['comment_digest', 'Comment digests', 'Hourly summary of unanswered comments'], ['collaboration', 'Collaboration', 'Approvals, notes and mentions from your team'], ['billing', 'Billing and payment reminders', 'Invoices, trial ending, failed payments']];
  return (<Section title="Email notifications" desc="Transactional emails (sign-in, security) are always sent.">{keys.map(([k, l, d]) => <label key={k} className="row" style={{ padding: '8px 0', borderBottom: '1px solid var(--border)' }}><input type="checkbox" checked={prefs.data?.notificationPrefs?.[k] ?? true} onChange={e => set.mutate({ key: k, enabled: e.target.checked })} /><div><b style={{ fontSize: 13 }}>{l}</b><div className="subtle">{d}</div></div></label>)}</Section>);
}

function Organization() {
  const me = useMe(); const save = useMutate(M.updateOrganization, { invalidate: [['me']], success: 'Saved' }); const org = me.data?.organization; const ent = org?.entitlements ?? {};
  const [name, setName] = useState(''); const [voice, setVoice] = useState(''); useEffect(() => { setName(org?.name ?? ''); setVoice(org?.settings?.brandVoice ?? ''); }, [org]);
  return (<><Section title="Organization"><div className="field"><label htmlFor="on">Name</label><input id="on" className="input" value={name} onChange={e => setName(e.target.value)} onBlur={() => name !== org?.name && save.mutate({ name })} /></div><div className="field"><label className="row"><input type="checkbox" disabled={!ent.require2fa} checked={!!org?.require2fa} onChange={e => save.mutate({ require2fa: e.target.checked })} /> Require two-factor authentication for all members {!ent.require2fa && <UpgradeHint feature="Require 2FA" />}</label></div><div className="field"><label className="row"><input type="checkbox" checked={!!org?.settings?.newChannelsNoAccess} onChange={e => save.mutate({ settings: { ...org.settings, newChannelsNoAccess: e.target.checked } })} /> New channels start with "No access" for members</label></div></Section>
    <Section title="Brand voice for AI" desc="Guides the AI Assistant and reply suggestions."><textarea className="textarea" value={voice} onChange={e => setVoice(e.target.value)} onBlur={() => voice !== (org?.settings?.brandVoice ?? '') && save.mutate({ settings: { ...org.settings, brandVoice: voice } })} placeholder="Friendly, concise, never salesy. We say 'teams' not 'users'. British spelling." /></Section></>);
}

function Team() {
  const members = useGql<any>(['members'], Q.members); const channels = useChannels(); const me = useMe(); const ent = me.data?.organization?.entitlements ?? {};
  const invite = useMutate(M.inviteMember, { invalidate: [['members']], success: 'Invitation sent' }); const update = useMutate(M.updateMember, { invalidate: [['members']], success: 'Saved' }); const remove = useMutate(M.removeMember, { invalidate: [['members']], success: 'Member removed' });
  const [email, setEmail] = useState(''); const [role, setRole] = useState('MEMBER'); const [editing, setEditing] = useState<any>(null); const [del, setDel] = useState<any>(null);
  return (<><Section title="Invite a teammate" desc={ent.users === 'unlimited' ? 'Team plan: unlimited members with per-channel permissions.' : 'Your plan includes one user. Upgrade to Team to collaborate.'}><form className="row" onSubmit={e => { e.preventDefault(); invite.mutate({ email, role }); setEmail(''); }}><input className="input" type="email" placeholder="colleague@company.com" value={email} onChange={e => setEmail(e.target.value)} aria-label="Email" required /><select className="select" style={{ width: 'auto' }} value={role} onChange={e => setRole(e.target.value)} aria-label="Role"><option value="MEMBER">Member</option><option value="ADMIN">Admin</option></select><button className="btn primary" disabled={ent.users !== 'unlimited'}>Invite</button>{ent.users !== 'unlimited' && <UpgradeHint feature="Team" />}</form></Section>
    <Section title="Members"><table className="table"><thead><tr><th>Member</th><th>Role</th><th>Status</th><th>Access</th><th></th></tr></thead><tbody>{(members.data?.organization?.members ?? []).map((m: any) => <tr key={m.id}><td><div className="row"><Avatar src={m.account?.avatarUrl} name={m.account?.name ?? m.account?.email} size="sm" /><div><b style={{ fontSize: 13 }}>{m.account?.name ?? m.invitedEmail ?? m.account?.email}</b><div className="subtle">{m.account?.email}</div></div></div></td><td><select className="select" style={{ width: 'auto', padding: '4px 8px' }} value={m.role} disabled={m.role === 'OWNER'} onChange={e => update.mutate({ membershipId: m.id, role: e.target.value })}><option value="OWNER">Owner</option><option value="ADMIN">Admin</option><option value="MEMBER">Member</option></select></td><td>{m.status === 'INVITED' ? <span className="tag warn">Invited</span> : <span className="tag brand">Active</span>}</td><td>{m.role === 'MEMBER' ? <button className="btn ghost sm" onClick={() => setEditing(m)} disabled={!ent.channelPermissions}>{m.channelGrants.filter((g: any) => g.publish === 'APPROVAL').length ? 'Needs approval on some' : 'Full access'} ✎</button> : <span className="subtle">All channels</span>}</td><td>{m.role !== 'OWNER' && <button className="btn ghost sm" onClick={() => setDel(m)}>Remove</button>}</td></tr>)}</tbody></table></Section>
    {editing && <Modal open onOpenChange={o => !o && setEditing(null)} title={`Permissions for ${editing.account?.name ?? editing.invitedEmail}`} size="sm" footer={<><span style={{ flex: 1 }} /><button className="btn primary" onClick={() => { update.mutate({ membershipId: editing.id, grants: editing.channelGrants.map((g: any) => ({ channelId: g.channelId, publish: g.publish, community: g.community })) }); setEditing(null); }}>Save</button></>}><table className="table"><thead><tr><th>Channel</th><th>Publishing</th><th>Community</th></tr></thead><tbody>{(channels.data?.channels ?? []).map((c: any) => { const g = editing.channelGrants.find((x: any) => x.channelId === c.id) ?? { channelId: c.id, publish: 'NONE', community: 'NONE' }; const setG = (patch: any) => setEditing({ ...editing, channelGrants: [...editing.channelGrants.filter((x: any) => x.channelId !== c.id), { ...g, ...patch }] }); return <tr key={c.id}><td><div className="row"><Avatar src={c.avatarUrl} name={c.displayName} network={c.network} size="sm" /> {c.displayName}</div></td><td><select className="select" style={{ padding: '4px 8px' }} value={g.publish} onChange={e => setG({ publish: e.target.value })}><option value="FULL">Full access</option><option value="APPROVAL">Needs approval</option><option value="NONE">No access</option></select></td><td><select className="select" style={{ padding: '4px 8px' }} value={g.community} onChange={e => setG({ community: e.target.value })}><option value="FULL">Full</option><option value="VIEW">View only</option><option value="NONE">None</option></select></td></tr>; })}</tbody></table></Modal>}
    <Confirm open={!!del} onOpenChange={o => !o && setDel(null)} title="Remove member?" body={<p>{del?.account?.email} will lose access immediately. Their posts stay.</p>} confirmLabel="Remove" danger onConfirm={() => remove.mutateAsync({ membershipId: del.id })} /></>);
}

function Tags() {
  const tags = useTags(); const me = useMe(); const ent = me.data?.organization?.entitlements ?? {};
  const create = useMutate(M.createTag, { invalidate: [['tags']] }); const update = useMutate(M.updateTag, { invalidate: [['tags']] }); const del = useMutate(M.deleteTag, { invalidate: [['tags']], success: 'Tag deleted' });
  const [name, setName] = useState(''); const [color, setColor] = useState('#6DB44F');
  return (<Section title="Tags" desc={`Tag posts to group campaigns in Insights. ${tags.data?.tags?.length ?? 0} of ${ent.tags ?? 3} used.`}><form className="row" onSubmit={e => { e.preventDefault(); create.mutate({ name, color }); setName(''); }}><input className="input" placeholder="New tag" value={name} onChange={e => setName(e.target.value)} aria-label="Tag name" /><input type="color" value={color} onChange={e => setColor(e.target.value)} aria-label="Tag colour" /><button className="btn primary" disabled={!name}>Add</button></form><div className="stack" style={{ marginTop: 12 }}>{(tags.data?.tags ?? []).map((t: any) => <div key={t.id} className="row"><input type="color" value={t.color} onChange={e => update.mutate({ id: t.id, color: e.target.value })} aria-label={`Colour for ${t.name}`} /><input className="input" defaultValue={t.name} onBlur={e => e.target.value !== t.name && update.mutate({ id: t.id, name: e.target.value })} aria-label="Tag name" /><span className="subtle">{t.postCount} posts</span><button className="btn ghost sm" onClick={() => del.mutate({ id: t.id })} aria-label={`Delete ${t.name}`}>✕</button></div>)}</div></Section>);
}

function SavedReplies() {
  const list = useGql<any>(['savedReplies'], Q.savedReplies); const me = useMe(); const ent = me.data?.organization?.entitlements ?? {};
  const save = useMutate(M.saveSavedReply, { invalidate: [['savedReplies']], success: 'Saved' }); const del = useMutate(M.deleteSavedReply, { invalidate: [['savedReplies']] });
  const [title, setTitle] = useState(''); const [body, setBody] = useState('');
  return (<Section title="Saved replies" desc={`Reusable answers for Community. ${ent.savedReplies === 'unlimited' ? 'Unlimited on your plan.' : `${list.data?.savedReplies?.length ?? 0} of ${ent.savedReplies} used.`}`}><form className="stack" onSubmit={e => { e.preventDefault(); save.mutate({ title, body }); setTitle(''); setBody(''); }}><input className="input" placeholder="Title (e.g. Shipping times)" value={title} onChange={e => setTitle(e.target.value)} aria-label="Title" /><textarea className="textarea" placeholder="Reply text (max 1,000 characters)" value={body} maxLength={1000} onChange={e => setBody(e.target.value)} aria-label="Body" /><button className="btn primary" disabled={!title || !body} style={{ alignSelf: 'flex-start' }}>Save reply</button></form><div className="stack" style={{ marginTop: 14 }}>{(list.data?.savedReplies ?? []).map((r: any) => <div key={r.id} className="card" style={{ padding: 10 }}><div className="row" style={{ justifyContent: 'space-between' }}><b style={{ fontSize: 13 }}>{r.title}</b><button className="btn ghost sm" onClick={() => del.mutate({ id: r.id })} aria-label={`Delete ${r.title}`}>✕</button></div><p className="subtle" style={{ margin: '4px 0 0', whiteSpace: 'pre-wrap' }}>{r.body}</p></div>)}</div></Section>);
}

function Integrations() {
  const items: [string, string, string | null, string][] = [['Bitly', 'Shorten links with your own Bitly account and see clicks in Insights.', null, 'Coming soon'], ['Canva', 'Create and import designs straight into the composer.', null, 'Coming soon'], ['Unsplash & GIPHY', 'Free photos and GIFs in the media picker.', null, 'Built in'], ['Google Drive & Photos', 'Pick files from Drive and Photos in the media picker.', null, 'Coming soon'], ['Dropbox', 'Attach files from Dropbox.', null, 'Coming soon'], ['Mailchimp', 'Email signup block on your Start Page (paste your form URL in the block).', null, 'Built in'], ['Zapier / Make / n8n', 'Automate with your API key.', '/settings/api', 'Connect'], ['MCP (Claude, ChatGPT, Cursor)', 'Use Relay from your AI assistant with the same API key.', '/settings/api', 'Connect']];
  return (<Section title="Apps & extras"><div className="stack">{items.map(([n, d, href, label]) => <div key={n} className="row" style={{ padding: '10px 0', borderBottom: '1px solid var(--border)' }}><div style={{ flex: 1 }}><b style={{ fontSize: 13 }}>{n}</b><div className="subtle">{d}</div></div>{href ? <a className="btn secondary sm" href={href}>{label}</a> : <span className="tag">{label}</span>}</div>)}</div></Section>);
}

function Api() {
  const keys = useGql<any>(['apiKeys'], Q.apiKeys); const me = useMe(); const ent = me.data?.organization?.entitlements ?? {};
  const create = useMutate(M.createApiKey, { invalidate: [['apiKeys']], onSuccess: (d: any) => setNewKey(d.createApiKey.key) }); const revoke = useMutate(M.revokeApiKey, { invalidate: [['apiKeys']], success: 'Key revoked' });
  const [name, setName] = useState(''); const [scopes, setScopes] = useState<string[]>(['posts:read', 'posts:write', 'ideas:read', 'ideas:write', 'account:read']); const [newKey, setNewKey] = useState<string | null>(null);
  return (<><Section title="API keys" desc={`Bearer keys for the GraphQL API at /graphql and the MCP server at /mcp. ${keys.data?.apiKeys?.length ?? 0} of ${ent.apiKeys ?? 1} used · ${ent.apiRequestsPer30d?.toLocaleString?.() ?? '3,000'} requests / 30 days.`}>
    <form className="stack" onSubmit={e => { e.preventDefault(); create.mutate({ name, scopes }); setName(''); }}><input className="input" placeholder="Key name (e.g. Zapier)" value={name} onChange={e => setName(e.target.value)} aria-label="Key name" /><div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>{['posts:read', 'posts:write', 'ideas:read', 'ideas:write', 'account:read', 'account:write'].map(s => <label key={s} className="row subtle"><input type="checkbox" checked={scopes.includes(s)} onChange={e => setScopes(x => (e.target.checked ? [...x, s] : x.filter(i => i !== s)))} /> {s}</label>)}</div><button className="btn primary" disabled={!name || !scopes.length} style={{ alignSelf: 'flex-start' }}>Create key</button></form>
    {newKey && <div className="banner info" style={{ marginTop: 12 }}><div className="grow"><b>Copy your key now — it won't be shown again.</b><pre className="ai-out" style={{ marginTop: 6 }}>{newKey}</pre></div><button className="btn secondary sm" onClick={() => { navigator.clipboard.writeText(newKey); toast('Copied'); }}>Copy</button></div>}
    <table className="table" style={{ marginTop: 12 }}><thead><tr><th>Name</th><th>Prefix</th><th>Scopes</th><th>Last used</th><th></th></tr></thead><tbody>{(keys.data?.apiKeys ?? []).map((k: any) => <tr key={k.id}><td>{k.name}</td><td><code>{k.prefix}…</code></td><td className="subtle">{k.scopes.join(', ')}</td><td className="subtle">{k.lastUsedAt ? fmtDateTime(k.lastUsedAt) : 'Never'}</td><td><button className="btn ghost sm" onClick={() => revoke.mutate({ id: k.id })}>Revoke</button></td></tr>)}</tbody></table></Section>
    <Section title="Quick start"><pre className="ai-out">{`curl ${typeof window !== 'undefined' ? location.origin : ''}/api/graphql \\
  -H "Authorization: Bearer rly_live_…" -H "content-type: application/json" \\
  -d '{"query":"{ channels { id network displayName } }"}'

# MCP (Claude, ChatGPT, Cursor): https://mcp.relay.app/mcp with the same bearer key`}</pre><p className="subtle">Docs: see <code>developers/README.md</code> in the repo (published at developers.&lt;your-domain&gt; in production) · Rate limits: 100 / 15 min, plus daily and 30-day quotas by plan · No webhooks in v1 — poll with <code>updatedAfter</code>.</p></Section></>);
}

function Audit() {
  const log = useGql<any>(['audit'], Q.auditLog, { take: 100 });
  return (<Section title="Activity log" desc="Security-relevant actions in this organization (admins only)."><table className="table"><thead><tr><th>When</th><th>Action</th><th>Entity</th><th>Details</th></tr></thead><tbody>{(log.data?.auditLog ?? []).map((e: any) => <tr key={e.id}><td className="subtle">{fmtDateTime(e.createdAt)}</td><td>{e.action}</td><td className="subtle">{e.entity} {e.entityId?.slice(0, 8)}</td><td className="subtle"><code style={{ fontSize: 11 }}>{e.diff ? JSON.stringify(e.diff).slice(0, 80) : ''}</code></td></tr>)}</tbody></table></Section>);
}
