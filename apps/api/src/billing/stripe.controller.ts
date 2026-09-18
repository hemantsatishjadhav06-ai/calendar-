import { Body, Controller, Get, Headers, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import type Stripe from 'stripe';
import { prismaAdmin } from '@relay/db';
import { assertCan } from '@relay/domain';
import { BillingService } from './billing.service.js';
import { requireTenant } from '../auth/session.middleware.js';
import { monthlyPriceCents } from '@relay/entitlements';

@Controller()
export class StripeController {
  constructor(private billing: BillingService) {}

  @Post('stripe/webhook')
  async webhook(@Req() req: Request, @Res() res: Response, @Headers('stripe-signature') sig: string) {
    let event: Stripe.Event;
    try { event = this.billing.constructEvent(req.body as Buffer, sig); } catch (e: any) { return res.status(400).send(`Webhook Error: ${e.message}`); }
    const dedupe = await prismaAdmin.webhookInbox.upsert({ where: { provider_eventId: { provider: 'stripe', eventId: event.id } }, create: { provider: 'stripe', eventId: event.id, payload: event as any, signatureOk: true }, update: {} });
    if (dedupe.processedAt) return res.json({ received: true, duplicate: true });
    switch (event.type) {
      case 'customer.subscription.created': case 'customer.subscription.updated': case 'customer.subscription.deleted': case 'customer.subscription.trial_will_end':
        await this.billing.sync(event.data.object as Stripe.Subscription); break;
      case 'invoice.upcoming': {
        // Apply pending channel reductions at renewal
        const inv = event.data.object as Stripe.Invoice; const subId = typeof inv.subscription === 'string' ? inv.subscription : inv.subscription?.id;
        if (subId) { const sub = await prismaAdmin.subscription.findUnique({ where: { stripeSubscriptionId: subId } }); if (sub?.pendingQuantity && sub.pendingQuantity < sub.channelQuantity) { const s = await (this.billing as any).stripe.subscriptions.retrieve(subId); await (this.billing as any).stripe.subscriptions.update(subId, { items: [{ id: s.items.data[0].id, quantity: sub.pendingQuantity }], proration_behavior: 'none' }); await prismaAdmin.subscription.update({ where: { organizationId: sub.organizationId }, data: { channelQuantity: sub.pendingQuantity, pendingQuantity: null } }); } }
        break;
      }
      case 'invoice.payment_failed': {
        const inv = event.data.object as Stripe.Invoice; const subId = typeof inv.subscription === 'string' ? inv.subscription : inv.subscription?.id;
        if (subId) await prismaAdmin.subscription.updateMany({ where: { stripeSubscriptionId: subId }, data: { status: 'past_due' } });
        break;
      }
      case 'checkout.session.completed': break;   // subscription.created follows
    }
    await prismaAdmin.webhookInbox.update({ where: { id: dedupe.id }, data: { processedAt: new Date() } });
    return res.json({ received: true });
  }

  @Get('billing')
  async summary() {
    const { tenant } = requireTenant();
    const sub = await prismaAdmin.subscription.findUniqueOrThrow({ where: { organizationId: tenant.organizationId } });
    const channels = await prismaAdmin.channel.count({ where: { organizationId: tenant.organizationId, deletedAt: null, network: { not: 'START_PAGE' } } });
    return { ...sub, channels, entitlements: tenant.entitlements, pricing: { essentials: { month: monthlyPriceCents('ESSENTIALS', Math.max(1, channels)), year: monthlyPriceCents('ESSENTIALS', Math.max(1, channels), 'year') }, team: { month: monthlyPriceCents('TEAM', Math.max(1, channels)), year: monthlyPriceCents('TEAM', Math.max(1, channels), 'year') } } };
  }
  @Post('billing/trial') async trial() { const { tenant, account } = requireTenant(); assertCan(tenant, 'org.billing'); await this.billing.startTrial(tenant.organizationId, account.email); return { ok: true }; }
  @Post('billing/checkout') async checkout(@Body() b: { plan: 'ESSENTIALS' | 'TEAM'; interval: 'month' | 'year' }) { const { tenant, account } = requireTenant(); assertCan(tenant, 'org.billing'); return { url: await this.billing.checkoutUrl(tenant.organizationId, account.email, b.plan, b.interval) }; }
  @Post('billing/change') async change(@Body() b: { plan: 'FREE' | 'ESSENTIALS' | 'TEAM'; interval: 'month' | 'year' }) { const { tenant } = requireTenant(); assertCan(tenant, 'org.billing'); await this.billing.changePlan(tenant.organizationId, b.plan, b.interval); return { ok: true }; }
  @Post('billing/portal') async portal() { const { tenant } = requireTenant(); assertCan(tenant, 'org.billing'); return { url: await this.billing.portalUrl(tenant.organizationId) }; }
}
