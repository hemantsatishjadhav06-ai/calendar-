import { Controller, Get, Post, Param, Body, Res, NotFoundException, BadRequestException } from '@nestjs/common';
import type { Response } from 'express';
import { prismaAdmin } from '@cadence/db';
import { env } from '@cadence/config';
import { readReviewToken } from './share.token.js';
import { pushToMany } from '../notifications/notify.js';
import { mail } from '../mail/mail.js';

/**
 * Client review link (agency "client portal"): an unauthenticated, unguessable signed token lets a
 * client view ONE pending post and record Approve / Request-changes. The token IS the capability and is
 * scoped to that single post. By design this NEVER mutates the publish queue — it records the client's
 * sign-off on the Approval, drops a Note, and notifies the team, who retain the actual publish action.
 */
@Controller('review')
export class ReviewController {
  @Get(':token')
  async show(@Param('token') token: string, @Res({ passthrough: true }) res: Response) {
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    const postId = readReviewToken(token);
    if (!postId) throw new NotFoundException('This review link is invalid or has expired.');
    const post = await prismaAdmin.post.findUnique({
      where: { id: postId },
      select: {
        id: true, status: true, baseText: true, baseMedia: true, createdAt: true,
        organization: { select: { name: true } },
        approval: { select: { clientDecision: true, clientDecidedAt: true, clientReviewerName: true, clientComment: true, decision: true } },
        targets: { select: { id: true, text: true, media: true, customized: true, thread: true, firstComment: true, dueAt: true, channel: { select: { network: true, displayName: true, handle: true, avatarUrl: true } } } },
      },
    });
    if (!post) throw new NotFoundException('This post is no longer available.');
    return {
      org: post.organization?.name ?? 'Cadence',
      status: post.status,
      baseText: post.baseText,
      baseMedia: post.baseMedia,
      approval: post.approval ?? null,
      targets: post.targets.map(t => ({ id: t.id, network: t.channel.network, channel: t.channel.displayName, handle: t.channel.handle, avatarUrl: t.channel.avatarUrl, text: t.customized ? t.text : post.baseText, media: (t.customized ? t.media : post.baseMedia) as unknown, thread: t.thread, firstComment: t.firstComment, dueAt: t.dueAt })),
    };
  }

  @Post(':token/decision')
  async decide(@Param('token') token: string, @Body() body: { decision?: string; reviewerName?: string; comment?: string }) {
    const postId = readReviewToken(token);
    if (!postId) throw new NotFoundException('This review link is invalid or has expired.');
    const decision = body?.decision === 'approved' ? 'approved' : body?.decision === 'changes' ? 'changes' : null;
    if (!decision) throw new BadRequestException('Choose approve or request changes.');
    const reviewerName = (body?.reviewerName ?? '').trim().slice(0, 80) || 'A client';
    const comment = (body?.comment ?? '').trim().slice(0, 1000) || null;

    const post = await prismaAdmin.post.findUnique({ where: { id: postId }, select: { id: true, organizationId: true, createdByAccountId: true, targets: { select: { channel: { select: { displayName: true } } } } } });
    if (!post) throw new NotFoundException('This post is no longer available.');

    await prismaAdmin.approval.upsert({
      where: { postId },
      create: { postId, requestedByAccountId: post.createdByAccountId, clientDecision: decision, clientDecidedAt: new Date(), clientReviewerName: reviewerName, clientComment: comment },
      update: { clientDecision: decision, clientDecidedAt: new Date(), clientReviewerName: reviewerName, clientComment: comment },
    });
    const verb = decision === 'approved' ? 'approved this post' : 'requested changes';
    await prismaAdmin.note.create({ data: { organizationId: post.organizationId, postId, authorAccountId: post.createdByAccountId, body: `Client review — ${reviewerName} ${verb}${comment ? `: ${comment}` : ''}` } }).catch(() => undefined);

    // Notify the team (owners/admins + the author) in-app and by email.
    const admins = await prismaAdmin.membership.findMany({ where: { organizationId: post.organizationId, status: 'ACTIVE', role: { in: ['OWNER', 'ADMIN'] } }, include: { account: true } });
    const recipients = [...new Set([post.createdByAccountId, ...admins.map(a => a.accountId)])];
    const chNames = post.targets.map(t => t.channel.displayName).join(', ');
    await pushToMany(recipients, { organizationId: post.organizationId, type: 'client.review', title: decision === 'approved' ? 'Client approved a post' : 'Client requested changes', body: `${reviewerName} ${verb} for ${chNames}${comment ? `: ${comment}` : ''}`, url: '/all-channels' });
    for (const a of admins) if (a.account?.email) await mail.send({ to: a.account.email, template: 'approval_decided', data: { channel: chNames, decision: decision === 'approved' ? 'Client approved' : 'Client requested changes', reason: comment ?? undefined, url: `${env.APP_URL}/all-channels` } }).catch(() => undefined);

    return { ok: true, decision };
  }
}
