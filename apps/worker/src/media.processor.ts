import { Worker, type Job } from 'bullmq';
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import sharp from 'sharp';
import ffmpeg from 'fluent-ffmpeg';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { env } from '@cadence/config';
import { prismaAdmin } from '@cadence/db';
import { connection, log, emit } from './infra.js';
import { IMAGE_SPECS, VIDEO_SPECS, type ImageSpec, type VideoSpec } from './media.specs.js';

const s3 = new S3Client({ region: env.S3_REGION, endpoint: env.S3_ENDPOINT, forcePathStyle: !!env.S3_ENDPOINT, credentials: env.S3_ACCESS_KEY ? { accessKeyId: env.S3_ACCESS_KEY, secretAccessKey: env.S3_SECRET_KEY! } : undefined });

export function mediaWorker() {
  return new Worker('media', async (job: Job) => {
    if (job.name === 'process') return processAsset(job.data.assetId);
    if (job.name === 'import') return importAsset(job.data.assetId, job.data.url, job.data.filename);
    if (job.name === 'render') return renderRendition(job.data.assetId, job.data.renditionKey);
    return 'unknown';
  }, { connection, concurrency: Number(process.env.MEDIA_CONCURRENCY ?? 4), lockDuration: 30 * 60_000 });
}

async function getBytes(key: string) { const o = await s3.send(new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: key })); return Buffer.from(await (o.Body as any).transformToByteArray()); }
async function put(key: string, body: Buffer, mime: string) { await s3.send(new PutObjectCommand({ Bucket: env.S3_BUCKET, Key: key, Body: body, ContentType: mime, CacheControl: 'public, max-age=31536000, immutable' })); }

/** Probe, strip EXIF (privacy), make thumb/preview renditions, mark ready. Network renditions are rendered lazily. */
export async function processAsset(assetId: string) {
  const asset = await prismaAdmin.asset.findUniqueOrThrow({ where: { id: assetId } });
  try {
    const bytes = await getBytes(asset.originalKey);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const dir = asset.originalKey.replace(/\/original\.[^/]+$/, '');
    let data: any = { sha256, bytes: bytes.length, status: 'ready' };
    const renditions: Record<string, any> = {};
    if (asset.kind === 'image' || asset.kind === 'gif') {
      const meta = await sharp(bytes, { animated: asset.kind === 'gif' }).metadata();
      data = { ...data, width: meta.width, height: meta.height, mime: `image/${meta.format}` };
      if (asset.kind === 'image') {
        // Re-encode original without metadata (EXIF/GPS), keep format where sensible
        const clean = await sharp(bytes).rotate().withMetadata({ exif: {} }).toFormat(meta.format === 'png' ? 'png' : 'jpeg', { quality: 92, mozjpeg: true }).toBuffer();
        const cleanKey = `${dir}/clean.${meta.format === 'png' ? 'png' : 'jpg'}`;
        await put(cleanKey, clean, meta.format === 'png' ? 'image/png' : 'image/jpeg');
        const m2 = await sharp(clean).metadata();
        renditions.clean = { key: cleanKey, mime: meta.format === 'png' ? 'image/png' : 'image/jpeg', bytes: clean.length, width: m2.width, height: m2.height };
      }
      for (const [k, w] of [['thumb', 400], ['preview', 1080]] as const) {
        const buf = await sharp(bytes, { animated: false }).rotate().resize({ width: w, withoutEnlargement: true }).webp({ quality: 82 }).toBuffer();
        const key = `${dir}/${k}.webp`; await put(key, buf, 'image/webp');
        const m = await sharp(buf).metadata(); renditions[k] = { key, mime: 'image/webp', bytes: buf.length, width: m.width, height: m.height };
      }
    } else if (asset.kind === 'video') {
      const tmp = await mkdtemp(join(tmpdir(), 'relay-'));
      const inPath = join(tmp, 'in.mp4'); await writeFile(inPath, bytes);
      const probe = await ffprobe(inPath);
      const v = probe.streams.find((s: any) => s.codec_type === 'video');
      data = { ...data, width: v?.width, height: v?.height, durationMs: Math.round(Number(probe.format.duration ?? 0) * 1000), fps: v?.r_frame_rate ? evalFps(v.r_frame_rate) : undefined, codec: v?.codec_name };
      const thumbPath = join(tmp, 'thumb.jpg');
      await new Promise<void>((res, rej) => ffmpeg(inPath).screenshots({ timestamps: [Math.min(1, Number(probe.format.duration ?? 1) / 2)], filename: 'thumb.jpg', folder: tmp, size: '640x?' }).on('end', () => res()).on('error', rej));
      const thumb = await sharp(await readFile(thumbPath)).webp({ quality: 80 }).toBuffer();
      const key = `${dir}/thumb.webp`; await put(key, thumb, 'image/webp'); renditions.thumb = { key, mime: 'image/webp', bytes: thumb.length, width: 640 };
      renditions.preview = renditions.thumb;
      await rm(tmp, { recursive: true, force: true });
    } else if (asset.kind === 'document') {
      data = { ...data, mime: 'application/pdf' };
    }
    await prismaAdmin.asset.update({ where: { id: assetId }, data: { ...data, renditions } });
    await emit(asset.organizationId, { type: 'asset.ready', assetId });
    return 'ready';
  } catch (e: any) {
    log.error({ assetId, err: e.message }, 'media processing failed');
    await prismaAdmin.asset.update({ where: { id: assetId }, data: { status: 'failed', error: e.message?.slice(0, 300) } });
    await emit(asset.organizationId, { type: 'asset.failed', assetId, error: e.message });
    throw e;
  }
}

/** Fetch a remote file (Unsplash/Giphy/Canva/Drive/Dropbox/link preview) into S3, then process. */
async function importAsset(assetId: string, url: string, filename?: string) {
  const asset = await prismaAdmin.asset.findUniqueOrThrow({ where: { id: assetId } });
  const r = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(60_000) });
  if (!r.ok) { await prismaAdmin.asset.update({ where: { id: assetId }, data: { status: 'failed', error: `Download failed (${r.status})` } }); return 'failed'; }
  const mime = (r.headers.get('content-type') ?? 'application/octet-stream').split(';')[0];
  const bytes = Buffer.from(await r.arrayBuffer());
  if (bytes.length > 512 * 1024 * 1024) { await prismaAdmin.asset.update({ where: { id: assetId }, data: { status: 'failed', error: 'File too large' } }); return 'failed'; }
  const kind = mime.startsWith('video/') ? 'video' : mime === 'image/gif' ? 'gif' : mime === 'application/pdf' ? 'document' : 'image';
  const ext = mime.split('/')[1]?.replace('jpeg', 'jpg').replace('quicktime', 'mov') ?? 'bin';
  const key = `orgs/${asset.organizationId}/assets/${assetId}/original.${ext}`;
  await put(key, bytes, mime);
  await prismaAdmin.asset.update({ where: { id: assetId }, data: { originalKey: key, mime, kind, bytes: bytes.length, sourceMeta: { ...(asset.sourceMeta as any), filename } } });
  // Unsplash guideline: trigger the download endpoint when the photo is actually used
  const dl = (asset.sourceMeta as any)?.downloadLocation; if (dl && env.UNSPLASH_ACCESS_KEY) fetch(dl, { headers: { Authorization: `Client-ID ${env.UNSPLASH_ACCESS_KEY}` } }).catch(() => undefined);
  return processAsset(assetId);
}

/** Produce (and cache) a network-specific rendition; called by connectors through resolveRendition when missing. */
export async function renderRendition(assetId: string, renditionKey: string) {
  const asset = await prismaAdmin.asset.findUniqueOrThrow({ where: { id: assetId } });
  if ((asset.renditions as any)[renditionKey]) return 'exists';
  const dir = asset.originalKey.replace(/\/original\.[^/]+$/, '');
  const spec = IMAGE_SPECS[renditionKey] ?? VIDEO_SPECS[renditionKey];
  if (!spec) return 'no-spec';
  const src = await getBytes((asset.renditions as any).clean?.key ?? asset.originalKey);
  let out: { key: string; mime: string; bytes: number; width?: number; height?: number; durationMs?: number };
  if ('format' in spec) {
    const r = await renderImage(src, spec as ImageSpec);
    const key = `${dir}/${renditionKey}.${spec.format === 'jpeg' ? 'jpg' : spec.format}`; await put(key, r.buf, r.mime);
    out = { key, mime: r.mime, bytes: r.buf.length, width: r.width, height: r.height };
  } else {
    const tmp = await mkdtemp(join(tmpdir(), 'relay-'));
    const inPath = join(tmp, 'in.mp4'), outPath = join(tmp, 'out.mp4'); await writeFile(inPath, src);
    await renderVideo(inPath, outPath, spec as VideoSpec);
    const buf = await readFile(outPath); const probe = await ffprobe(outPath); const v = probe.streams.find((s: any) => s.codec_type === 'video');
    const key = `${dir}/${renditionKey}.mp4`; await put(key, buf, 'video/mp4');
    out = { key, mime: 'video/mp4', bytes: buf.length, width: v?.width, height: v?.height, durationMs: Math.round(Number(probe.format.duration ?? 0) * 1000) };
    await rm(tmp, { recursive: true, force: true });
  }
  await prismaAdmin.asset.update({ where: { id: assetId }, data: { renditions: { ...(asset.renditions as any), [renditionKey]: out } } });
  return 'rendered';
}

export async function renderImage(input: Buffer, spec: ImageSpec) {
  let img = sharp(input, { failOn: 'none', animated: false }).rotate().withMetadata({ exif: {} });
  const meta = await img.metadata();
  if (spec.aspect && meta.width && meta.height) {
    const r = meta.width / meta.height;
    if (r < spec.aspect[0] || r > spec.aspect[1]) {
      const target = Math.min(Math.max(r, spec.aspect[0]), spec.aspect[1]);
      const w = r > target ? Math.round(meta.height * target) : meta.width, h = r > target ? meta.height : Math.round(meta.width / target);
      img = img.resize(w, h, { fit: 'cover', position: 'attention' });
    }
  }
  if (spec.maxW) img = img.resize({ width: spec.maxW, withoutEnlargement: true });
  if (spec.minW && meta.width && meta.width < spec.minW) img = img.resize({ width: spec.minW });
  let quality = spec.quality ?? 88, buf: Buffer;
  do { buf = await img.clone().toFormat(spec.format as any, spec.format === 'png' ? {} : { quality, mozjpeg: spec.format === 'jpeg' }).toBuffer(); quality -= 6; } while (buf.length > spec.maxBytes && quality > 35);
  if (buf.length > spec.maxBytes) { // last resort: shrink dimensions
    for (let w = spec.maxW ?? meta.width ?? 1440; buf.length > spec.maxBytes && w > 320; w = Math.round(w * 0.8)) buf = await img.clone().resize({ width: w }).toFormat(spec.format as any, { quality: 70 }).toBuffer();
  }
  const out = await sharp(buf).metadata();
  return { buf, mime: `image/${spec.format}`, width: out.width!, height: out.height! };
}

export function renderVideo(inPath: string, outPath: string, s: VideoSpec) {
  return new Promise<void>((resolve, reject) => {
    const cmd = ffmpeg(inPath).videoCodec('libx264').audioCodec('aac').audioBitrate(`${s.aBitrateK}k`).audioFrequency(48000).audioChannels(2)
      .outputOptions(['-profile:v high', '-level 4.1', '-pix_fmt yuv420p', `-g ${s.gop}`, `-keyint_min ${s.gop}`, '-sc_threshold 0', `-r ${s.fps}`, `-b:v ${s.vBitrateK}k`, `-maxrate ${s.vBitrateK}k`, `-bufsize ${s.vBitrateK * 2}k`, '-movflags +faststart', '-preset medium']);
    if (s.w && s.h) cmd.outputOptions([`-vf scale=${s.w}:${s.h}:force_original_aspect_ratio=decrease:force_divisible_by=2${s.pad ? `,pad=${s.w}:${s.h}:(ow-iw)/2:(oh-ih)/2:color=black` : ''}`]);
    else if (s.maxW) cmd.outputOptions([`-vf scale='min(${s.maxW},iw)':-2`]);
    if (s.maxDurationS) cmd.outputOptions([`-t ${s.maxDurationS}`]);
    cmd.on('end', () => resolve()).on('error', reject).save(outPath);
  });
}

const ffprobe = (p: string) => new Promise<any>((res, rej) => ffmpeg.ffprobe(p, (e, d) => (e ? rej(e) : res(d))));
const evalFps = (s: string) => { const [a, b] = s.split('/').map(Number); return b ? Math.round((a / b) * 100) / 100 : a; };
