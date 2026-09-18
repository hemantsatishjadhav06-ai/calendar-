import { Controller, Get, Param, Res, NotFoundException } from '@nestjs/common';
import type { Response } from 'express';
import { prismaAdmin } from '@relay/db';
import { readShareToken } from './share.token.js';

/**
 * Public, read-only preview of a single post behind an unguessable signed token (see share.token.ts).
 * No authentication: the token IS the capability. It returns only that one post's preview — never any
 * other org data — and is marked noindex. This is the "share a draft for review" / client-preview flow
 * that Buffer, shoutrrr (/share/{token}) and BrightBean (client portal) all offer.
 */
@Controller('share')
export class ShareController {
  @Get(':token')
  async show(@Param('token') token: string, @Res({ passthrough: true }) res: Response) {
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    const postId = readShareToken(token);
    if (!postId) throw new NotFoundException('This share link is invalid or has expired.');

    const post = await prismaAdmin.post.findUnique({
      where: { id: postId },
      select: {
        id: true, status: true, scheduleMode: true, baseText: true, baseMedia: true, createdAt: true,
        organization: { select: { name: true } },
        targets: {
          select: {
            id: true, text: true, media: true, customized: true, thread: true, firstComment: true, dueAt: true, status: true,
            channel: { select: { network: true, displayName: true, handle: true, avatarUrl: true } },
          },
        },
      },
    });
    if (!post) throw new NotFoundException('This post is no longer available.');

    return {
      org: post.organization?.name ?? 'Relay',
      author: null as string | null,
      status: post.status,
      scheduleMode: post.scheduleMode,
      baseText: post.baseText,
      baseMedia: post.baseMedia,
      targets: post.targets.map(t => ({
        id: t.id,
        network: t.channel.network,
        channel: t.channel.displayName,
        handle: t.channel.handle,
        avatarUrl: t.channel.avatarUrl,
        text: t.customized ? t.text : post.baseText,
        media: (t.customized ? t.media : post.baseMedia) as unknown,
        thread: t.thread,
        firstComment: t.firstComment,
        dueAt: t.dueAt,
        status: t.status,
      })),
    };
  }
}
