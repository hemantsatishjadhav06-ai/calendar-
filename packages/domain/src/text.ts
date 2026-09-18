const URL_RE = /\bhttps?:\/\/[^\s<>()"']+|\bwww\.[^\s<>()"']+/gi;
const HASHTAG_RE = /(^|[^\w&])#([\p{L}\p{N}_]+)/gu;
const MENTION_RE = /(^|[^\w@])@([\w.\-@]+)/g;

export const extractUrls = (text: string): string[] => Array.from(new Set(text.match(URL_RE) ?? []));
export const extractHashtags = (text: string): string[] => Array.from(new Set(Array.from(text.matchAll(HASHTAG_RE), m => m[2].toLowerCase())));
export const extractMentions = (text: string): string[] => Array.from(new Set(Array.from(text.matchAll(MENTION_RE), m => m[2])));
export const countGraphemes = (text: string): number => {
  const seg = (Intl as any).Segmenter ? new (Intl as any).Segmenter(undefined, { granularity: 'grapheme' }) : null;
  return seg ? Array.from(seg.segment(text)).length : Array.from(text).length;
};
export const firstLine = (text: string) => (text.split(/\r?\n/).find(l => l.trim()) ?? '').trim();
export const truncate = (text: string, n: number) => (text.length > n ? text.slice(0, n - 1) + '…' : text);
export const unique = <T>(xs: T[]) => Array.from(new Set(xs));
export const chunks = <T>(xs: T[], n: number): T[][] => { const out: T[][] = []; for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n)); return out; };
export const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
export const unix = (d: Date) => Math.floor(d.getTime() / 1000);
export const ymd = (d: Date) => ({ year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() });
export const hm = (d: Date) => ({ hours: d.getUTCHours(), minutes: d.getUTCMinutes() });
