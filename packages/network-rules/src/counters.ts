import twitter from 'twitter-text';

const URL_RE = /\bhttps?:\/\/[^\s<>()"']+|\bwww\.[^\s<>()"']+/gi;
const HASHTAG_RE = /(^|[^\w&])#([\p{L}\p{N}_]+)/gu;

export const graphemes = (t: string) => {
  const S = (Intl as any).Segmenter;
  return S ? Array.from(new S(undefined, { granularity: 'grapheme' }).segment(t)).length : Array.from(t).length;
};
export const codepoints = (t: string) => Array.from(t).length;
export const utf16 = (t: string) => t.length;
export const countUrls = (t: string) => (t.match(URL_RE) ?? []).length;
export const countHashtags = (t: string) => Array.from(t.matchAll(HASHTAG_RE)).length;
export const countMentions = (t: string) => (t.match(/(^|[^\w@])@[\w.]+/g) ?? []).length;

/** X weighted length: URLs 23, CJK 2, emoji 2, via twitter-text. */
export const xWeighted = (t: string) => twitter.parseTweet(t).weightedLength;

/** Mastodon: every URL counts as `charsPerUrl` (default 23); @user@domain counts only @user. */
export function mastodonLength(t: string, charsPerUrl = 23) {
  let s = t.replace(URL_RE, 'x'.repeat(charsPerUrl));
  s = s.replace(/(^|[^\w@])@([\w.\-]+)@[\w.\-]+/g, '$1@$2');
  return codepoints(s);
}

/** Threads counts text in code points; URLs count fully. */
export const threadsLength = codepoints;
