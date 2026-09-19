import { S3Client, GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env } from '@cadence/config';
import { prismaAdmin } from '@cadence/db';
import type { MediaRef } from '../types.js';
import { ConnectorError } from './errors.js';

export const s3 = new S3Client({ region: env.S3_REGION, endpoint: env.S3_ENDPOINT, forcePathStyle: !!env.S3_ENDPOINT, credentials: env.S3_ACCESS_KEY ? { accessKeyId: env.S3_ACCESS_KEY, secretAccessKey: env.S3_SECRET_KEY! } : undefined });

export interface Rendition { key: string; mime: string; bytes: number; width?: number; height?: number; durationMs?: number }

/** Resolve the S3 key for a rendition, falling back to the original if the rendition was not produced. */
export async function resolveRendition(m: MediaRef, renditionKey: string): Promise<Rendition> {
  const asset = await prismaAdmin.asset.findUnique({ where: { id: m.assetId } });
  if (!asset) throw new ConnectorError('MEDIA', `Asset ${m.assetId} not found`, { retryable: false });
  if (asset.status !== 'ready') throw new ConnectorError('MEDIA', `Asset ${m.assetId} is ${asset.status}`, { retryable: asset.status === 'processing' });
  const existing = (asset.renditions as unknown as Record<string, Rendition>)[renditionKey];
  if (existing) return existing;
  // Lazily render the network-specific rendition (the media worker owns sharp/ffmpeg); wait up to 5 minutes.
  const { Queue, QueueEvents } = await import('bullmq');
  const q = new Queue('media', { connection: { url: env.REDIS_URL } as any });
  const qe = new QueueEvents('media', { connection: { url: env.REDIS_URL } as any });
  try {
    const job = await q.add('render', { assetId: m.assetId, renditionKey }, { jobId: `render-${m.assetId}-${renditionKey}`, removeOnComplete: true });
    await job.waitUntilFinished(qe, 5 * 60_000);
  } catch (e: any) {
    if (!/already exists|Missing lock|finished/i.test(String(e?.message))) throw new ConnectorError('MEDIA', `Could not prepare media for this network: ${e?.message ?? e}`, { retryable: true });
  } finally { await q.close(); await qe.close(); }
  const refreshed = await prismaAdmin.asset.findUniqueOrThrow({ where: { id: m.assetId } });
  const r = (refreshed.renditions as unknown as Record<string, Rendition>)[renditionKey];
  if (r) return r;
  const clean = (refreshed.renditions as unknown as Record<string, Rendition>).clean;
  return clean ?? { key: refreshed.originalKey, mime: refreshed.mime, bytes: refreshed.bytes, width: refreshed.width ?? undefined, height: refreshed.height ?? undefined, durationMs: refreshed.durationMs ?? undefined };
}

/** Publicly fetchable URL (signed, time-limited) for networks that pull media by URL (Meta, Threads, TikTok, Pinterest, GBP). */
export async function mediaUrl(m: MediaRef, renditionKey: string, opts: { ttlSec?: number } = {}): Promise<string> {
  const r = await resolveRendition(m, renditionKey);
  if (env.MEDIA_CDN_BASE && env.NODE_ENV === 'production') {
    // CloudFront signed URL on our verified domain (TikTok requires a verified domain for PULL_FROM_URL)
    return `${env.MEDIA_CDN_BASE}/${r.key}?${await cdnSignature(r.key, opts.ttlSec ?? 7200)}`;
  }
  return getSignedUrl(s3, new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: r.key }), { expiresIn: opts.ttlSec ?? 7200 });
}

/** Stream (or buffer) bytes for networks that need the file (X, LinkedIn, YouTube, Bluesky, Mastodon). */
export async function streamFromS3(m: MediaRef, renditionKey: string) {
  const r = await resolveRendition(m, renditionKey);
  const obj = await s3.send(new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: r.key }));
  const stream = obj.Body as unknown as AsyncIterable<Uint8Array>;
  return {
    ...r, size: r.bytes, stream,
    /** Buffer everything — only for assets known to be small (images, ≤ 100 MB videos). */
    get bytes(): Promise<Buffer> { return (async () => { const parts: Uint8Array[] = []; for await (const c of stream) parts.push(c); return Buffer.concat(parts); })(); },
  };
}

/** Split an async byte stream into fixed-size chunks (last one smaller). */
export async function* chunkStream(stream: AsyncIterable<Uint8Array>, size: number): AsyncGenerator<Buffer> {
  let buf = Buffer.alloc(0);
  for await (const c of stream) {
    buf = Buffer.concat([buf, Buffer.from(c)]);
    while (buf.length >= size) { yield buf.subarray(0, size); buf = buf.subarray(size); }
  }
  if (buf.length) yield buf;
}

export async function headSize(key: string) { const h = await s3.send(new HeadObjectCommand({ Bucket: env.S3_BUCKET, Key: key })); return h.ContentLength ?? 0; }

async function cdnSignature(key: string, ttlSec: number) {
  // Placeholder for CloudFront signed-URL params (use @aws-sdk/cloudfront-signer in infra); dev falls back to S3 presign above.
  const { createHmac } = await import('node:crypto');
  const exp = Math.floor(Date.now() / 1000) + ttlSec;
  const sig = createHmac('sha256', env.SESSION_SECRET).update(`${key}:${exp}`).digest('base64url');
  return `exp=${exp}&sig=${sig}`;
}
