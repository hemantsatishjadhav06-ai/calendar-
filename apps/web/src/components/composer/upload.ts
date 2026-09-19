'use client';
import { rest } from '@/lib/api';
import type { MediaItem } from './store';

async function sha256(file: File) {
  const buf = await crypto.subtle.digest('SHA-256', await file.slice(0, Math.min(file.size, 64 * 1024 * 1024)).arrayBuffer());   // hash first 64 MB (+size in key) to keep it fast for big videos
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 56) + file.size.toString(16).padStart(8, '0');
}

/** Direct-to-S3 upload (single PUT or multipart), then waits for the media worker to mark the asset ready. */
export async function uploadFile(file: File, onProgress: (p: number) => void, source = 'upload', sourceMeta?: Record<string, any>): Promise<MediaItem> {
  const kind = file.type.startsWith('video/') ? 'video' : file.type === 'image/gif' ? 'gif' : file.type === 'application/pdf' ? 'document' : 'image';
  const created = await rest('/uploads', { method: 'POST', json: { filename: file.name, mime: file.type, bytes: file.size, sha256: await sha256(file), source, sourceMeta } });
  if (created.deduplicated) return toItem(created.asset);
  const { asset, upload } = created;
  if (upload.type === 'single') {
    await putWithProgress(upload.url, file, file.type, onProgress);
    await rest(`/uploads/${asset.id}/complete`, { method: 'POST', json: {} });
  } else {
    const parts: { ETag: string; PartNumber: number }[] = [];
    for (let i = 0; i < upload.urls.length; i++) {
      const chunk = file.slice(i * upload.partSize, Math.min(file.size, (i + 1) * upload.partSize));
      const etag = await putWithProgress(upload.urls[i], chunk, file.type, p => onProgress((i + p) / upload.urls.length));
      parts.push({ ETag: etag, PartNumber: i + 1 });
    }
    await rest(`/uploads/${asset.id}/complete`, { method: 'POST', json: { uploadId: upload.uploadId, parts } });
  }
  return waitReady(asset.id, kind);
}

export async function importUrl(url: string, source: string, sourceMeta?: Record<string, any>): Promise<MediaItem> {
  const { asset } = await rest('/uploads/import', { method: 'POST', json: { url, source, sourceMeta } });
  return waitReady(asset.id, 'image');
}

/** Crop/rotate an image server-side (via the media worker) into a new asset; resolves when it's ready. */
export async function transformImage(assetId: string, ops: { rotate?: number; aspect?: string | null }): Promise<MediaItem> {
  const { asset } = await rest(`/uploads/${assetId}/transform`, { method: 'POST', json: ops });
  return waitReady(asset.id, 'image');
}

async function waitReady(assetId: string, kind: MediaItem['kind']): Promise<MediaItem> {
  for (let i = 0; i < 120; i++) {
    const a = await rest(`/uploads/${assetId}`);
    if (a.status === 'ready') return toItem(a);
    if (a.status === 'failed') throw new Error(a.error ?? 'Media processing failed');
    await new Promise(r => setTimeout(r, i < 10 ? 1000 : 3000));
  }
  return { assetId, kind, status: 'processing' };
}

const toItem = (a: any): MediaItem => ({ assetId: a.id, kind: a.kind, mime: a.mime, bytes: a.bytes, width: a.width, height: a.height, durationMs: a.durationMs, thumbUrl: a.thumbUrl ?? a.url, previewUrl: a.previewUrl ?? a.url, altText: a.altTextDefault ?? '', status: 'ready' });

function putWithProgress(url: string, body: Blob, mime: string, onProgress: (p: number) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest(); xhr.open('PUT', url);
    xhr.setRequestHeader('content-type', mime);
    xhr.upload.onprogress = e => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => (xhr.status < 300 ? resolve((xhr.getResponseHeader('ETag') ?? '').replace(/"/g, '')) : reject(new Error(`Upload failed (${xhr.status})`)));
    xhr.onerror = () => reject(new Error('Upload failed'));
    xhr.send(body);
  });
}
