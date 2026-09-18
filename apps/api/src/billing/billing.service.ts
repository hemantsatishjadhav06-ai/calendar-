import { Injectable } from '@nestjs/common';
import Stripe from 'stripe';
import { env } from '@relay/config';
import { prismaAdmin, type Plan } from '@relay/db';
import { DomainError } from '@relay/domain';
import { QueueOps } from '@relay/domain';

@Injectable()
export class BillingService {
  private stripe = env.STRIPE_SECRET_KEY ? new Stripe(env.STRIPE_SECRET_KEY, { apiVersion: '2024-11-20.acacia' as any }) : null;

  private price(plan: Exclude<Plan, 'FREE'>, interval: 'month' | 'year') {
    const id = plan === 'ESSENTIALS' ? (interval === 'month' ? env.STRIPE_PRICE_ESSENTIALS_MONTHLY : env.STRIPE_PRICE_ESSENTIALS_YEARLY) : (interval === 'month' ? env.STRIPE_PRICE_TEAM_MONTHLY : env.STRIPE_PRICE_TEAM_YEARLY);
    if (!id) throw new DomainError('INTERNAL', 'Stripe prices are not configured');
    return id;
  }
  private need() { if (!this.stripe) throw new DomainError('INTERNAL', 'Billing is not configured'); return this.stripe; }

  async ensureCustomer(organizationId: string, email: string) {
    const stripe = this.need();
    const sub = await prismaAdmin.subscription.findUniqueOrThrow({ where: { organizationId } });
    if (sub.stripeCustomerId) return sub.stripeCustomerId;
    const org = await prismaAdmin.organization.findUniqueOrThrow({ where: { id: organizationId } });
    const c = await stripe.customers.create({ email, name: org.name, metadata: { organizationId } });
    await prismaAdmin.subscription.update({ where: { organizationId }, data: { stripeCustomerId: c.id } });
    return c.id;
  }

  /** Start a Team trial without a card (Buffer parity: 14 days on Team). */
  async startTrial(organizationId: string, email: string) {
    const stripe = this.need();
    const customer = await this.ensureCustomer(organizationId, email);
    const sub = await prismaAdmin.subscription.findUniqueOrThrow({ where: { organizationId } });
    if (sub.stripeSubscriptionId || sub.trialEndsAt) throw new DomainError('CONFLICT', 'A trial or subscription already exists');
    const qty = Math.max(1, await prismaAdmin.channel.count({ where: { organizationId, deletedAt: null, network: { not: 'START_PAGE' } } }));
    const s = await stripe.subscriptions.create({ customer, items: [{ price: this.price('TEAM', 'month'), quantity: qty }], trial_period_days: 14, trial_settings: { end_behavior: { missing_payment_method: 'cancel' } }, payment_settings: { save_default_payment_method: 'on_subscription' }, metadata: { organizationId } });
    await this.sync(s);
  }

  /** Checkout for a new paid plan (card capture). */
  async checkoutUrl(organizationId: string, email: string, plan: Exclude<Plan, 'FREE'>, interval: 'month' | 'year') {
    const stripe = this.need();
    const customer = await this.ensureCustomer(organizationId, email);
    const qty = Math.max(1, await prismaAdmin.channel.count({ where: { organizationId, deletedAt: null, network: { not: 'START_PAGE' } } }));
    const session = await stripe.checkout.sessions.create({ mode: 'subscription', customer, line_items: [{ price: this.price(plan, interval), quantity: qty }], success_url: `${env.APP_URL}/billing?success=1`, cancel_url: `${env.APP_URL}/billing`, subscription_data: { metadata: { organizationId } }, allow_promotion_codes: true, tax_id_collection: { enabled: true }, billing_address_collection: 'required' });
    return session.url!;
  }

  /** Change plan / interval with proration; downgrade to FREE cancels at period end. */
  async changePlan(organizationId: string, plan: Plan, interval: 'month' | 'year') {
    const stripe = this.need();
    const sub = await prismaAdmin.subscription.findUniqueOrThrow({ where: { organizationId } });
    if (!sub.stripeSubscriptionId) throw new DomainError('CONFLICT', 'No active subscription');
    const s = await stripe.subscriptions.retrieve(sub.stripeSubscriptionId);
    if (plan === 'FREE') { await stripe.subscriptions.update(s.id, { cancel_at_period_end: true }); await prismaAdmin.subscription.update({ where: { organizationId }, data: { cancelAtPeriodEnd: true } }); return; }
    await stripe.subscriptions.update(s.id, { cancel_at_period_end: false, items: [{ id: s.items.data[0].id, price: this.price(plan, interval), quantity: s.items.data[0].quantity }], proration_behavior: 'always_invoice' });
  }

  /** Channel added on a paid plan → immediate prorated quantity increase. Removal → decrease at next renewal (pendingQuantity). */
  async syncQuantity(organizationId: string) {
    const stripe = this.stripe; if (!stripe) return;
    const sub = await prismaAdmin.subscription.findUniqueOrThrow({ where: { organizationId } });
    if (!sub.stripeSubscriptionId || sub.plan === 'FREE') return;
    const qty = Math.max(1, await prismaAdmin.channel.count({ where: { organizationId, deletedAt: null, network: { not: 'START_PAGE' } } }));
    if (qty > sub.channelQuantity) {
      const s = await stripe.subscriptions.retrieve(sub.stripeSubscriptionId);
      await stripe.subscriptions.update(s.id, { items: [{ id: s.items.data[0].id, quantity: qty }], proration_behavior: 'always_invoice' });
      await prismaAdmin.subscription.update({ where: { organizationId }, data: { channelQuantity: qty, pendingQuantity: null } });
    } else if (qty < sub.channelQuantity) {
      await prismaAdmin.subscription.update({ where: { organizationId }, data: { pendingQuantity: qty } });
    }
  }

  async portalUrl(organizationId: string) {
    const stripe = this.need();
    const sub = await prismaAdmin.subscription.findUniqueOrThrow({ where: { organizationId } });
    if (!sub.stripeCustomerId) throw new DomainError('CONFLICT', 'No billing account yet');
    const p = await stripe.billingPortal.sessions.create({ customer: sub.stripeCustomerId, return_url: `${env.APP_URL}/billing` });
    return p.url;
  }

  /** Mirror Stripe state into Subscription and apply channel locks. */
  async sync(s: Stripe.Subscription) {
    const organizationId = s.metadata?.organizationId; if (!organizationId) return;
    const priceId = s.items.data[0]?.price.id;
    const plan: Plan = [env.STRIPE_PRICE_TEAM_MONTHLY, env.STRIPE_PRICE_TEAM_YEARLY].includes(priceId) ? 'TEAM' : [env.STRIPE_PRICE_ESSENTIALS_MONTHLY, env.STRIPE_PRICE_ESSENTIALS_YEARLY].includes(priceId) ? 'ESSENTIALS' : 'FREE';
    const ended = ['canceled', 'incomplete_expired', 'unpaid'].includes(s.status);
    await prismaAdmin.subscription.update({ where: { organizationId }, data: {
      plan: ended ? 'FREE' : plan, interval: s.items.data[0]?.price.recurring?.interval ?? 'month', stripeSubscriptionId: ended ? null : s.id, stripePriceId: priceId, status: s.status,
      channelQuantity: ended ? 3 : (s.items.data[0]?.quantity ?? 1), trialEndsAt: s.trial_end ? new Date(s.trial_end * 1000) : null, currentPeriodEnd: new Date(s.current_period_end * 1000), cancelAtPeriodEnd: s.cancel_at_period_end,
    } });
    await this.applyLocks(organizationId);
  }

  /** Lock channels beyond the paid quantity (oldest stay active), unlock when capacity returns. */
  async applyLocks(organizationId: string) {
    const sub = await prismaAdmin.subscription.findUniqueOrThrow({ where: { organizationId } });
    const limit = sub.plan === 'FREE' ? 3 : sub.channelQuantity;
    const channels = await prismaAdmin.channel.findMany({ where: { organizationId, deletedAt: null, network: { not: 'START_PAGE' } }, orderBy: { connectedAt: 'asc' } });
    const ops = new QueueOps(prismaAdmin);
    for (const [i, ch] of channels.entries()) {
      const shouldLock = i >= limit;
      if (shouldLock && ch.status !== 'LOCKED') { await prismaAdmin.channel.update({ where: { id: ch.id }, data: { status: 'LOCKED', statusReason: 'Exceeds plan channel limit' } }); await ops.reflow(ch.id); }
      if (!shouldLock && ch.status === 'LOCKED') { await prismaAdmin.channel.update({ where: { id: ch.id }, data: { status: 'ACTIVE', statusReason: null } }); await ops.reflow(ch.id); }
    }
  }

  constructEvent(raw: Buffer, sig: string) { return this.need().webhooks.constructEvent(raw, sig, env.STRIPE_WEBHOOK_SECRET!); }
}
