import { DateTime } from 'luxon';

export const NETWORK_LABEL: Record<string, string> = { FACEBOOK: 'Facebook', INSTAGRAM: 'Instagram', THREADS: 'Threads', X: 'X', LINKEDIN: 'LinkedIn', TIKTOK: 'TikTok', YOUTUBE: 'YouTube', PINTEREST: 'Pinterest', GOOGLE_BUSINESS: 'Google Business', BLUESKY: 'Bluesky', MASTODON: 'Mastodon', DEVTO: 'DEV.to', START_PAGE: 'Start Page' };
export const NETWORK_SHORT: Record<string, string> = { FACEBOOK: 'f', INSTAGRAM: 'ig', THREADS: '@', X: 'X', LINKEDIN: 'in', TIKTOK: 'tt', YOUTUBE: '▶', PINTEREST: 'P', GOOGLE_BUSINESS: 'G', BLUESKY: 'bs', MASTODON: 'm', DEVTO: 'DEV', START_PAGE: 'S' };
export const STATUS_LABEL: Record<string, string> = { DRAFT: 'Draft', PENDING_APPROVAL: 'Awaiting approval', QUEUED: 'Queued', SCHEDULED: 'Scheduled', PUBLISHING: 'Publishing…', PUBLISHED: 'Published', PARTIALLY_PUBLISHED: 'Partially published', FAILED: 'Failed', NOTIFIED: 'Reminder sent', CANCELLED: 'Cancelled' };

export const fmtTime = (iso: string | Date | null | undefined, zone?: string, fmt = 'HH:mm') => (iso ? DateTime.fromJSDate(new Date(iso)).setZone(zone ?? 'local').toFormat(fmt) : '—');
export const fmtDate = (iso: string | Date, zone?: string) => DateTime.fromJSDate(new Date(iso)).setZone(zone ?? 'local').toFormat('ccc d LLL');
export const fmtDateTime = (iso: string | Date, zone?: string) => DateTime.fromJSDate(new Date(iso)).setZone(zone ?? 'local').toFormat('ccc d LLL, HH:mm');
export const dayKey = (iso: string | Date, zone?: string) => DateTime.fromJSDate(new Date(iso)).setZone(zone ?? 'local').toISODate()!;
export const relDay = (iso: string | Date, zone?: string) => { const d = DateTime.fromJSDate(new Date(iso)).setZone(zone ?? 'local').startOf('day'); const t = DateTime.now().setZone(zone ?? 'local').startOf('day'); const diff = d.diff(t, 'days').days; return diff === 0 ? 'Today' : diff === 1 ? 'Tomorrow' : diff === -1 ? 'Yesterday' : d.toFormat('cccc'); };
export const timeAgo = (iso: string | Date) => { const d = DateTime.fromJSDate(new Date(iso)); const m = Math.round(DateTime.now().diff(d, 'minutes').minutes); if (m < 1) return 'now'; if (m < 60) return `${m}m`; const h = Math.round(m / 60); if (h < 24) return `${h}h`; const dd = Math.round(h / 24); return dd < 7 ? `${dd}d` : d.toFormat('d LLL'); };
export const compact = (n: number | null | undefined) => n == null ? '—' : Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(n);
export const pct = (n: number | null | undefined, digits = 1) => n == null ? '—' : `${(n * 100).toFixed(digits)}%`;
export const truncate = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
export const initials = (s?: string | null) => (s ?? '?').split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();
export const tzList = (): string[] => { try { return (Intl as any).supportedValuesOf('timeZone'); } catch { return ['UTC', 'Asia/Kolkata', 'Europe/London', 'America/New_York', 'America/Los_Angeles', 'Australia/Sydney']; } };
