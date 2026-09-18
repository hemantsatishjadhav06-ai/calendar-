'use client';
import { Suspense, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import { TopBar } from '@/components/shell/TopBar';
import { rest } from '@/lib/api';
import { toast } from '@/components/ui/toast';
import { Confirm } from '@/components/ui/primitives';
import { fmtDate } from '@/lib/format';

const FEATURES: Record<string, string[]> = {
  FREE: ['3 channels', '10 scheduled posts per channel', '1 user', 'Insights (30-day history)', 'AI Assistant', 'Community inbox (5 AI replies/week)', '100 ideas, 3 tags'],
  ESSENTIALS: ['Unlimited channels (per-channel pricing)', 'Unlimited scheduled posts', 'Advanced analytics, comparisons, custom UTMs', 'Hashtag manager, first comment, Shop Grid', 'Share next, video covers, shortener choice', 'Unlimited AI replies, 5 saved replies', 'Unlimited ideas, 250 tags'],
  TEAM: ['Everything in Essentials', 'Unlimited users', 'Approval workflows', 'Per-channel permissions', 'Require 2FA', 'Branded (white-label) reports', 'Unlimited saved replies', '5 API keys, 15,000 requests/30d'],
};
const $ = (c: number) => `$${(c / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

export default function BillingPage() { return <Suspense fallback={null}><BillingInner /></Suspense>; }

function BillingInner() {
  const params = useSearchParams();
  const b = useQuery({ queryKey: ['billing'], queryFn: () => rest('/billing') });
  const [interval, setInterval_] = useState<'month' | 'year'>('month'); const [confirmFree, setConfirmFree] = useState(false); const [busy, setBusy] = useState(false);
  const d = b.data; const channels = Math.max(1, d?.channels ?? 1);
  const act = async (fn: () => Promise<any>) => { setBusy(true); try { const r = await fn(); if (r?.url) location.href = r.url; else { toast('Updated', { tone: 'success' }); b.refetch(); } } catch (e: any) { toast(e.message, { tone: 'danger' }); } finally { setBusy(false); } };
  return (
    <>
      <TopBar title="Plans & billing" />
      <main className="content" id="main">
        {params.get('success') && <div className="banner info" role="status">Thanks! Your subscription is active.</div>}
        {d && <div className="card row" style={{ marginBottom: 18, justifyContent: 'space-between', flexWrap: 'wrap' }}><div><b>Current plan: {d.plan}</b>{d.status === 'trialing' && d.trialEndsAt && <span className="tag warn" style={{ marginLeft: 8 }}>Trial ends {fmtDate(d.trialEndsAt)}</span>}{d.status === 'past_due' && <span className="tag danger" style={{ marginLeft: 8 }}>Payment failed</span>}{d.cancelAtPeriodEnd && <span className="tag" style={{ marginLeft: 8 }}>Cancels {fmtDate(d.currentPeriodEnd)}</span>}<div className="subtle">{d.channels} channel{d.channels === 1 ? '' : 's'} connected{d.plan !== 'FREE' ? ` · billed ${d.interval}ly · renews ${d.currentPeriodEnd ? fmtDate(d.currentPeriodEnd) : '—'}` : ''}{d.pendingQuantity ? ` · drops to ${d.pendingQuantity} channels at renewal` : ''}</div></div><div className="row">{d.stripeCustomerId && <button className="btn secondary sm" disabled={busy} onClick={() => act(() => rest('/billing/portal', { method: 'POST' }))}>Invoices & payment method</button>}{d.plan === 'FREE' && !d.trialEndsAt && <button className="btn primary sm" disabled={busy} onClick={() => act(() => rest('/billing/trial', { method: 'POST' }))}>Start 14-day Team trial</button>}</div></div>}
        <div className="row" style={{ marginBottom: 14 }}><div className="tabs" role="radiogroup" aria-label="Billing interval"><button role="radio" aria-checked={interval === 'month'} className="tab" style={{ border: 0, cursor: 'pointer', background: interval === 'month' ? 'var(--bg-inset)' : 'none' }} onClick={() => setInterval_('month')}>Monthly</button><button role="radio" aria-checked={interval === 'year'} className="tab" style={{ border: 0, cursor: 'pointer', background: interval === 'year' ? 'var(--bg-inset)' : 'none' }} onClick={() => setInterval_('year')}>Yearly <span className="tag brand">save 20%</span></button></div><span className="subtle">Prices shown for {channels} channel{channels > 1 ? 's' : ''}. Volume tiers: 1–10, 11–25, 26–50, 51+.</span></div>
        <div className="pricing">
          {(['FREE', 'ESSENTIALS', 'TEAM'] as const).map(plan => { const price = plan === 'FREE' ? 0 : d?.pricing?.[plan.toLowerCase()]?.[interval] ?? 0; const current = d?.plan === plan; return (
            <div key={plan} className={`card price-card ${current ? 'current' : ''}`}>
              <h2 style={{ marginTop: 0, fontSize: 18 }}>{plan === 'FREE' ? 'Free' : plan === 'ESSENTIALS' ? 'Essentials' : 'Team'}</h2>
              <div className="price">{plan === 'FREE' ? '$0' : $(interval === 'year' ? price / 12 : price)}<span className="subtle" style={{ fontSize: 13, fontWeight: 400 }}>/mo{plan !== 'FREE' && interval === 'year' ? ` (${$(price)}/yr)` : ''}</span></div>
              <p className="subtle">{plan === 'FREE' ? 'For getting started' : plan === 'ESSENTIALS' ? `from $${interval === 'year' ? 5 : 6}/channel/mo` : `from $${interval === 'year' ? 10 : 12}/channel/mo`}</p>
              <ul style={{ paddingLeft: 18, fontSize: 13 }}>{FEATURES[plan].map(f => <li key={f}>{f}</li>)}</ul>
              {current ? <button className="btn secondary" disabled>Current plan</button> : plan === 'FREE' ? <button className="btn secondary" disabled={busy} onClick={() => setConfirmFree(true)}>Downgrade to Free</button> : d?.stripeSubscriptionId ? <button className="btn primary" disabled={busy} onClick={() => act(() => rest('/billing/change', { method: 'POST', json: { plan, interval } }))}>Switch to {plan.toLowerCase()}</button> : <button className="btn primary" disabled={busy} onClick={() => act(() => rest('/billing/checkout', { method: 'POST', json: { plan, interval } }))}>Choose {plan.toLowerCase()}</button>}
            </div>); })}
        </div>
        <p className="subtle" style={{ marginTop: 16 }}>Adding a channel on a paid plan is prorated immediately; removing one takes effect at your next renewal. All prices in USD. Taxes calculated at checkout.</p>
      </main>
      <Confirm open={confirmFree} onOpenChange={setConfirmFree} title="Downgrade to Free?" body={<p>At the end of your billing period, channels beyond 3 are locked (not deleted), team members lose access and paid features turn off. You can upgrade again any time.</p>} confirmLabel="Downgrade at period end" danger onConfirm={() => act(() => rest('/billing/change', { method: 'POST', json: { plan: 'FREE', interval } }))} />
    </>
  );
}
