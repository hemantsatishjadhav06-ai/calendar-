import { Controller, Get, Param } from '@nestjs/common';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env } from '@cadence/config';
import { prismaAdmin } from '@cadence/db';
import { requireTenant } from '../auth/session.middleware.js';

const s3 = new S3Client({ region: env.S3_REGION, endpoint: env.S3_ENDPOINT, forcePathStyle: !!env.S3_ENDPOINT, credentials: env.S3_ACCESS_KEY ? { accessKeyId: env.S3_ACCESS_KEY, secretAccessKey: env.S3_SECRET_KEY! } : undefined });

/** "Notify me" reminder page data: caption to copy, media to download, per-network steps. */
@Controller('notify')
export class NotifyController {
  @Get(':targetId')
  async get(@Param('targetId') targetId: string) {
    const { tenant } = requireTenant();
    const t = await prismaAdmin.postTarget.findFirstOrThrow({ where: { id: targetId, organizationId: tenant.organizationId }, include: { channel: true, post: true, notification: true } });
    await prismaAdmin.notificationJob.updateMany({ where: { postTargetId: t.id, openedAt: null }, data: { openedAt: new Date() } });
    const media = await Promise.all(((t.media as any[]) ?? []).map(async m => { const a = await prismaAdmin.asset.findUnique({ where: { id: m.assetId } }); return a ? { ...m, downloadUrl: await getSignedUrl(s3, new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: (a.renditions as any).clean?.key ?? a.originalKey, ResponseContentDisposition: 'attachment' }), { expiresIn: 3600 }), thumbUrl: (a.renditions as any).thumb?.key ? await getSignedUrl(s3, new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: (a.renditions as any).thumb.key }), { expiresIn: 3600 }) : null } : m; }));
    const steps: Record<string, string[]> = {
      INSTAGRAM: ['Download the media below', 'Open Instagram → tap +', `Choose ${(t.metadata as any)?.postType === 'story' ? 'Story' : (t.metadata as any)?.postType === 'reel' ? 'Reel' : 'Post'}`, 'Paste the caption', 'Add stickers, music or product tags, then share'],
      TIKTOK: ['Download the video', 'Open TikTok → tap +', 'Upload the video, paste the caption', 'Pick sounds/effects and post'],
      YOUTUBE: ['Download the video', 'Open YouTube → Create → Upload a Short', 'Paste the title and description'],
      FACEBOOK: ['Open the Facebook Group', 'Create a post and paste the text', 'Attach the media'],
    };
    return { id: t.id, channel: { id: t.channel.id, network: t.channel.network, displayName: t.channel.displayName, avatarUrl: t.channel.avatarUrl }, status: t.status, text: t.text, firstComment: t.firstComment, media, steps: steps[t.channel.network] ?? ['Open the app', 'Paste the text and attach the media', 'Post'], dueAt: t.dueAt, completedAt: t.notification?.completedAt ?? null };
  }
}
