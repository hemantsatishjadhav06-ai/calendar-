import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { S3Client, CreateMultipartUploadCommand, UploadPartCommand, CompleteMultipartUploadCommand, AbortMultipartUploadCommand, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { z } from 'zod';
import { env } from '@cadence/config';
import { prismaAdmin } from '@cadence/db';
import { DomainError } from '@cadence/domain';
import { requireTenant } from '../auth/session.middleware.js';
import { QueuesService } from '../infra/queues.service.js';

const s3 = new S3Client({ region: env.S3_REGION, endpoint: env.S3_ENDPOINT, forcePathStyle: !!env.S3_ENDPOINT, credentials: env.S3_ACCESS_KEY ? { accessKeyId: env.S3_ACCESS_KEY, secretAccessKey: env.S3_SECRET_KEY! } : undefined });
const PART_SIZE = 8 * 1024 * 1024;
const ALLOWED = /^(image\/(jpeg|png|webp|gif|heic|heif|avif)|video\/(mp4|quicktime|webm|x-m4v)|application\/pdf)$/;

const Create = z.object({ filename: z.string().max(255), mime: z.string().regex(ALLOWED, 'Unsupported file type'), bytes: z.number().int().positive().max(5 * 1024 ** 3), sha256: z.string().length(64), source: z.string().default('upload'), sourceMeta: z.record(z.any()).optional() });

@Controller('uploads')
export class UploadsController {
  constructor(private queues: QueuesService) {}

  /** Step 1: create asset + presigned multipart upload (or return the existing asset when the same bytes were uploaded before). */
  @Post()
  async create(@Body() body: unknown) {
    const { tenant, account } = requireTenant();
    const input = Create.parse(body);
    const existing = await prismaAdmin.asset.findFirst({ where: { organizationId: tenant.organizationId, sha256: input.sha256, status: 'ready' } });
    if (existing) return { asset: existing, deduplicated: true };
    const kind = input.mime.startsWith('video/') ? 'video' : input.mime === 'image/gif' ? 'gif' : input.mime === 'application/pdf' ? 'document' : 'image';
    const ext = input.filename.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '') ?? 'bin';
    const asset = await prismaAdmin.asset.create({ data: { organizationId: tenant.organizationId, uploadedByAccountId: account.id, kind, originalKey: '', mime: input.mime, bytes: input.bytes, sha256: input.sha256, source: input.source, sourceMeta: input.sourceMeta ?? {}, status: 'uploading' } });
    const key = `orgs/${tenant.organizationId}/assets/${asset.id}/original.${ext}`;
    await prismaAdmin.asset.update({ where: { id: asset.id }, data: { originalKey: key } });
    if (input.bytes <= PART_SIZE) {
      const url = await getSignedUrl(s3, new PutObjectCommand({ Bucket: env.S3_BUCKET, Key: key, ContentType: input.mime }), { expiresIn: 3600 });
      return { asset, upload: { type: 'single', url } };
    }
    const mp = await s3.send(new CreateMultipartUploadCommand({ Bucket: env.S3_BUCKET, Key: key, ContentType: input.mime }));
    const parts = Math.ceil(input.bytes / PART_SIZE);
    const urls = await Promise.all(Array.from({ length: parts }, (_, i) => getSignedUrl(s3, new UploadPartCommand({ Bucket: env.S3_BUCKET, Key: key, UploadId: mp.UploadId!, PartNumber: i + 1 }), { expiresIn: 3600 })));
    return { asset, upload: { type: 'multipart', uploadId: mp.UploadId, partSize: PART_SIZE, urls } };
  }

  /** Step 2: finalize → media worker probes, strips EXIF, creates thumbnails. */
  @Post(':id/complete')
  async complete(@Param('id') id: string, @Body() body: { uploadId?: string; parts?: { ETag: string; PartNumber: number }[] }) {
    const { tenant } = requireTenant();
    const asset = await prismaAdmin.asset.findFirstOrThrow({ where: { id, organizationId: tenant.organizationId } });
    if (asset.status !== 'uploading') throw new DomainError('CONFLICT', 'Upload already completed');
    if (body.uploadId) await s3.send(new CompleteMultipartUploadCommand({ Bucket: env.S3_BUCKET, Key: asset.originalKey, UploadId: body.uploadId, MultipartUpload: { Parts: (body.parts ?? []).sort((a, b) => a.PartNumber - b.PartNumber) } }));
    await prismaAdmin.asset.update({ where: { id }, data: { status: 'processing' } });
    await this.queues.get('media').add('process', { assetId: id, organizationId: tenant.organizationId }, { jobId: `media-${id}` });
    return { ok: true };
  }

  @Post(':id/abort')
  async abort(@Param('id') id: string, @Body() body: { uploadId?: string }) {
    const { tenant } = requireTenant();
    const asset = await prismaAdmin.asset.findFirstOrThrow({ where: { id, organizationId: tenant.organizationId } });
    if (body.uploadId) await s3.send(new AbortMultipartUploadCommand({ Bucket: env.S3_BUCKET, Key: asset.originalKey, UploadId: body.uploadId })).catch(() => undefined);
    await prismaAdmin.asset.delete({ where: { id } });
    return { ok: true };
  }

  /** Import from a URL (Unsplash, Giphy, Canva export, Drive/Dropbox direct links, link-preview images). */
  @Post('import')
  async importUrl(@Body() body: { url: string; source: string; sourceMeta?: Record<string, any>; filename?: string }) {
    const { tenant, account } = requireTenant();
    const url = new URL(body.url);
    if (!/^https:$/.test(url.protocol)) throw new DomainError('VALIDATION', 'Only https URLs can be imported');
    const asset = await prismaAdmin.asset.create({ data: { organizationId: tenant.organizationId, uploadedByAccountId: account.id, kind: 'image', originalKey: '', mime: 'application/octet-stream', bytes: 0, sha256: '', source: body.source, sourceMeta: { ...(body.sourceMeta ?? {}), url: body.url }, status: 'processing' } });
    await this.queues.get('media').add('import', { assetId: asset.id, organizationId: tenant.organizationId, url: body.url, filename: body.filename }, { jobId: `import-${asset.id}` });
    return { asset };
  }

  @Get()
  async list(@Query('kind') kind?: string, @Query('cursor') cursor?: string) {
    const { tenant } = requireTenant();
    const items = await prismaAdmin.asset.findMany({ where: { organizationId: tenant.organizationId, status: 'ready', ...(kind ? { kind } : {}) }, orderBy: { createdAt: 'desc' }, take: 50, ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}) });
    return { items: items.map(a => ({ ...a, url: `${env.MEDIA_CDN_BASE}/${(a.renditions as any)?.preview?.key ?? a.originalKey}`, thumbUrl: `${env.MEDIA_CDN_BASE}/${(a.renditions as any)?.thumb?.key ?? a.originalKey}` })), nextCursor: items.at(-1)?.id ?? null };
  }

  @Get(':id')
  async get(@Param('id') id: string) {
    const { tenant } = requireTenant();
    const a = await prismaAdmin.asset.findFirstOrThrow({ where: { id, organizationId: tenant.organizationId } });
    const signed = async (key: string) => getSignedUrl(s3, new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: key }), { expiresIn: 3600 });
    return { ...a, url: await signed(a.originalKey), previewUrl: (a.renditions as any)?.preview?.key ? await signed((a.renditions as any).preview.key) : null, thumbUrl: (a.renditions as any)?.thumb?.key ? await signed((a.renditions as any).thumb.key) : null };
  }
}
