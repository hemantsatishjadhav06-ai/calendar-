import { env } from '@cadence/config';
import pino from 'pino';

const log = pino({ name: 'mail' });

export type Template = 'invite' | 'approval_requested' | 'approval_decided' | 'post_failed' | 'channel_reconnect' | 'notify_me' | 'digest_comments' | 'empty_queue' | 'verify_email' | 'password_reset' | 'trial_ending' | 'payment_failed';

const subjects: Record<Template, (d: any) => string> = {
  invite: d => `${d.inviter} invited you to ${d.orgName} on Cadence`,
  approval_requested: d => `Post awaiting your approval: ${d.preview}`,
  approval_decided: d => `Your post was ${String(d.decision).toLowerCase()}`,
  post_failed: d => `A post to ${d.channel} failed to publish`,
  channel_reconnect: d => `Reconnect ${d.channel} to keep publishing`,
  notify_me: d => `Time to post to ${d.channel}`,
  digest_comments: d => `${d.count} unanswered comments`,
  empty_queue: d => `${d.channel}'s queue is empty`,
  verify_email: () => 'Verify your email',
  password_reset: () => 'Reset your password',
  trial_ending: d => `Your Cadence trial ends in ${d.days} days`,
  payment_failed: () => 'We could not process your payment',
};

const btn = (url: string, label: string) => `<p style="margin:24px 0"><a href="${url}" style="background:#6DB44F;color:#0B1F0B;padding:10px 16px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block">${label}</a></p>`;
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

const bodies: Record<Template, (d: any) => string> = {
  invite: d => `<p>${esc(d.inviter)} invited you to join <b>${esc(d.orgName)}</b>.</p>${btn(d.url, 'Accept invitation')}`,
  approval_requested: d => `<p>${esc(d.requester)} requested approval for a post to ${esc(d.channel)}:</p><blockquote style="border-left:3px solid #E2DED6;margin:0;padding:4px 12px;color:#4F4B44">${esc(d.preview)}</blockquote>${btn(d.url, 'Review post')}`,
  approval_decided: d => `<p>Your post to ${esc(d.channel)} was <b>${esc(String(d.decision).toLowerCase())}</b>${d.reason ? `: ${esc(d.reason)}` : ''}.</p>${btn(d.url, 'Open post')}`,
  post_failed: d => `<p>Your post to <b>${esc(d.channel)}</b> could not be published.</p><p><b>Reason:</b> ${esc(d.reason)}</p>${btn(d.url, 'Fix and retry')}`,
  channel_reconnect: d => `<p><b>${esc(d.channel)}</b> needs to be reconnected. Scheduled posts are paused until then.</p>${btn(d.url, 'Reconnect channel')}`,
  notify_me: d => `<p>Your reminder for <b>${esc(d.channel)}</b> is ready. Open it to copy the caption and download the media.</p>${btn(d.url, 'Open reminder')}`,
  digest_comments: d => `<p>You have <b>${esc(d.count)}</b> unanswered comments across your channels.</p>${btn(d.url, 'Open Community')}`,
  empty_queue: d => `<p>The queue for <b>${esc(d.channel)}</b> is empty. Add posts to keep your schedule full.</p>${btn(d.url, 'Add posts')}`,
  verify_email: d => `<p>Confirm your email to finish setting up Cadence.</p>${btn(d.url, 'Verify email')}`,
  password_reset: d => `<p>Use the link below to choose a new password. It expires in one hour.</p>${btn(d.url, 'Reset password')}`,
  trial_ending: d => `<p>Your Team trial ends in ${esc(d.days)} days. Add a payment method to keep approvals, permissions and branded reports.</p>${btn(d.url, 'Manage billing')}`,
  payment_failed: d => `<p>Your latest payment did not go through. Update your card to avoid interruptions.</p>${btn(d.url, 'Update payment method')}`,
};

export function render(template: Template, d: any) {
  return { subject: subjects[template](d), html: `<!doctype html><html><body style="font-family:Inter,Segoe UI,Arial,sans-serif;color:#1F1D1A;max-width:560px;margin:0 auto;padding:24px;line-height:1.5"><h2 style="margin-top:0">Cadence</h2>${bodies[template](d)}<p style="color:#8C877D;font-size:12px;margin-top:32px">You receive this because you use Cadence. Manage notifications in Settings → Notifications.</p></body></html>` };
}

export const mail = {
  async send(m: { to: string; template: Template; data: any }) {
    const { subject, html } = render(m.template, m.data);
    if (!env.RESEND_API_KEY) { log.info({ to: m.to, subject }, 'mail (dev, not sent)'); return; }
    const r = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' }, body: JSON.stringify({ from: env.MAIL_FROM, to: m.to, subject, html }) });
    if (!r.ok) log.warn({ status: r.status, to: m.to }, 'mail send failed');
  },
};
