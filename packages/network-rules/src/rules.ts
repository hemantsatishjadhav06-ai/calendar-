import { z } from 'zod';
import type { NetworkRules } from './types.js';
import { codepoints, graphemes, mastodonLength, threadsLength, utf16, xWeighted } from './counters.js';

const IMG = ['jpeg', 'png', 'webp', 'heic'];
const VID = ['mp4', 'mov'];

export const facebookRules: NetworkRules = {
  network: 'FACEBOOK', label: 'Facebook',
  text: { max: 63206, counter: codepoints },
  media: { maxImages: 10, maxVideos: 1, mixImagesVideo: false, gif: true, image: { formats: [...IMG, 'gif'], maxBytes: 10e6 }, video: { formats: VID, maxBytes: 1e9, minS: 1, maxS: ctx => ctx.metadata.postType === 'reel' ? 90 : ctx.metadata.postType === 'story' ? 60 : 14400 }, altTextMax: 1000 },
  postTypes: [{ id: 'post', label: 'Post', media: 'either', count: [0, 10] }, { id: 'reel', label: 'Reel', media: 'video', count: [1, 1] }, { id: 'story', label: 'Story', media: 'either', count: [1, 1] }],
  features: { firstComment: true, location: false, userTags: false, linkPreviewEditable: 'domainVerified', polls: false, scheduleNative: true, notifyMe: false, like: true, hide: true, deleteComment: true, reply: true },
  quota: { note: 'Reels: 30 per 24h' },
  metadataSchema: z.object({ postType: z.enum(['post', 'reel', 'story']).default('post'), title: z.string().max(255).optional(), link: z.string().url().optional() }).passthrough(),
};

export const instagramRules: NetworkRules = {
  network: 'INSTAGRAM', label: 'Instagram',
  text: { max: 2200, counter: codepoints, hashtagsMax: 30, mentionsMax: 20 },
  media: { maxImages: 10, maxVideos: 10, mixImagesVideo: true, gif: false, requireMedia: true, image: { formats: IMG, maxBytes: 8e6, aspect: [0.8, 1.91], minW: 320 }, video: { formats: VID, maxBytes: 1e9, minS: 3, maxS: ctx => ctx.metadata.postType === 'story' ? 60 : ctx.media.length > 1 ? 60 : 900, aspect: [0.01, 10] }, altTextMax: 1000 },
  postTypes: [{ id: 'post', label: 'Post', media: 'either', count: [1, 10] }, { id: 'reel', label: 'Reel', media: 'video', count: [1, 1] }, { id: 'story', label: 'Story', media: 'either', count: [1, 1] }],
  features: { firstComment: true, location: true, userTags: true, linkPreviewEditable: 'none', polls: false, scheduleNative: false, notifyMe: true, shopGrid: true, like: false, hide: true, deleteComment: true, reply: true },
  quota: { postsPerDay: 100 },
  metadataSchema: z.object({ postType: z.enum(['post', 'reel', 'story']).default('post'), shareToFeed: z.boolean().optional(), locationId: z.string().optional(), collaborators: z.array(z.string()).max(3).optional(), shopGridLink: z.string().url().optional(), audioName: z.string().max(100).optional(), productTags: z.array(z.any()).optional() }).passthrough(),
};

export const threadsRules: NetworkRules = {
  network: 'THREADS', label: 'Threads',
  text: { max: 500, counter: threadsLength, linksMax: 5 },
  thread: { maxParts: 25 },
  media: { maxImages: 20, maxVideos: 20, mixImagesVideo: true, gif: false, image: { formats: ['jpeg', 'png'], maxBytes: 8e6 }, video: { formats: VID, maxBytes: 1e9, minS: 1, maxS: 300 }, altTextMax: 1000 },
  features: { firstComment: false, location: true, userTags: false, linkPreviewEditable: 'none', polls: true, scheduleNative: false, notifyMe: false, like: false, hide: true, deleteComment: true, reply: true },
  quota: { postsPerDay: 250 },
  metadataSchema: z.object({ topicTag: z.string().max(50).optional(), replyControl: z.enum(['everyone', 'accounts_you_follow', 'mentioned_only', 'followers_only', 'parent_post_author_only']).optional(), poll: z.object({ option_a: z.string().max(25), option_b: z.string().max(25), option_c: z.string().max(25).optional(), option_d: z.string().max(25).optional() }).optional() }).passthrough(),
};

export const xRules: NetworkRules = {
  network: 'X', label: 'X',
  text: { max: ctx => (ctx.premium ? 25000 : 280), counter: xWeighted, urlWeight: 23 },
  thread: { maxParts: 25 },
  media: { maxImages: 4, maxVideos: 1, mixImagesVideo: false, gif: true, image: { formats: ['jpeg', 'png', 'webp'], maxBytes: 5e6 }, video: { formats: VID, maxBytes: 512e6, minS: 0.5, maxS: 140, aspect: [1 / 3, 3] }, altTextMax: 1000 },
  features: { firstComment: false, location: false, userTags: true, linkPreviewEditable: 'none', polls: true, scheduleNative: false, notifyMe: false, like: true, hide: true, deleteComment: false, reply: true },
  quota: { note: 'Pay-per-use: $0.015 per post, $0.20 when the post contains a link' },
  metadataSchema: z.object({ poll: z.object({ options: z.array(z.string().max(25)).min(2).max(4), durationMinutes: z.number().min(5).max(10080).default(1440) }).optional(), replySettings: z.enum(['everyone', 'following', 'mentionedUsers', 'subscribers', 'verified']).optional(), quoteTweetId: z.string().optional() }).passthrough(),
};

export const linkedinRules: NetworkRules = {
  network: 'LINKEDIN', label: 'LinkedIn',
  text: { max: 3000, counter: codepoints },
  media: { maxImages: 20, maxVideos: 1, mixImagesVideo: false, gif: false, image: { formats: ['jpeg', 'png'], maxBytes: 8e6 }, video: { formats: VID, maxBytes: 5e9, minS: 3, maxS: 1800 }, document: { maxBytes: 100e6, maxPages: 300 }, altTextMax: 300 },
  features: { firstComment: true, location: false, userTags: false, linkPreviewEditable: 'full', polls: true, scheduleNative: false, notifyMe: false, title: { max: 200, required: false }, like: true, hide: false, deleteComment: true, reply: true },
  quota: { postsPerDay: 150 },
  metadataSchema: z.object({ visibility: z.enum(['PUBLIC', 'CONNECTIONS', 'LOGGED_IN']).optional(), title: z.string().max(200).optional(), document: z.object({ title: z.string().min(1).max(200) }).optional(), poll: z.object({ question: z.string().max(140), options: z.array(z.string().max(30)).min(2).max(4), duration: z.enum(['ONE_DAY', 'THREE_DAYS', 'SEVEN_DAYS', 'FOURTEEN_DAYS']).default('SEVEN_DAYS') }).optional(), mentions: z.array(z.object({ display: z.string(), urn: z.string() })).optional(), disableReshare: z.boolean().optional() }).passthrough(),
};

export const tiktokRules: NetworkRules = {
  network: 'TIKTOK', label: 'TikTok',
  text: { max: ctx => (ctx.media[0]?.kind === 'video' ? 2200 : 4000), counter: utf16, hashtagsMax: 5 },
  media: { maxImages: 35, maxVideos: 1, mixImagesVideo: false, gif: false, requireMedia: true, image: { formats: ['jpeg', 'webp'], maxBytes: 20e6 }, video: { formats: ['mp4', 'webm', 'mov'], maxBytes: 4e9, minS: 3, maxS: ctx => ctx.channel.meta.maxVideoPostDurationSec ?? 600 } },
  features: { firstComment: false, location: false, userTags: false, linkPreviewEditable: 'none', polls: false, scheduleNative: false, notifyMe: true, like: false, hide: false, deleteComment: false, reply: false },
  quota: { postsPerDay: 15 },
  metadataSchema: z.object({ privacyLevel: z.enum(['PUBLIC_TO_EVERYONE', 'MUTUAL_FOLLOW_FRIENDS', 'FOLLOWER_OF_CREATOR', 'SELF_ONLY']), disableDuet: z.boolean().optional(), disableComment: z.boolean().optional(), disableStitch: z.boolean().optional(), brandContent: z.boolean().optional(), brandOrganic: z.boolean().optional(), aiGenerated: z.boolean().optional(), photoTitle: z.string().max(90).optional(), autoAddMusic: z.boolean().optional() }).passthrough(),
};

export const youtubeRules: NetworkRules = {
  network: 'YOUTUBE', label: 'YouTube Shorts',
  text: { max: 5000, counter: utf16, hashtagsMax: 15 },
  media: { maxImages: 0, maxVideos: 1, mixImagesVideo: false, gif: false, requireMedia: true, image: { formats: [], maxBytes: 0 }, video: { formats: ['mp4', 'mov', 'webm', 'avi', 'mpeg'], maxBytes: 256e9, minS: 1, maxS: 43200 } },
  features: { firstComment: false, location: false, userTags: false, linkPreviewEditable: 'none', polls: false, scheduleNative: true, notifyMe: true, title: { max: 100, required: true }, like: false, hide: true, deleteComment: true, reply: true },
  quota: { postsPerDay: 100, note: '100 uploads/day per Google Cloud project' },
  metadataSchema: z.object({ title: z.string().min(1).max(100).refine(t => !/[<>]/.test(t), 'Title cannot contain < or >'), privacyStatus: z.enum(['public', 'private', 'unlisted']).default('public'), madeForKids: z.boolean().default(false), categoryId: z.string().optional(), tags: z.array(z.string()).max(30).optional(), playlistId: z.string().optional(), publishAt: z.string().datetime().optional(), notifySubscribers: z.boolean().optional(), aiGenerated: z.boolean().optional(), language: z.string().optional() }).passthrough(),
};

export const pinterestRules: NetworkRules = {
  network: 'PINTEREST', label: 'Pinterest',
  text: { max: 800, counter: codepoints },
  media: { maxImages: 5, maxVideos: 1, mixImagesVideo: false, gif: false, requireMedia: true, image: { formats: ['jpeg', 'png'], maxBytes: 20e6, minW: 100 }, video: { formats: ['mp4', 'mov', 'm4v'], maxBytes: 2e9, minS: 4, maxS: 900 }, altTextMax: 500 },
  features: { firstComment: false, location: false, userTags: false, linkPreviewEditable: 'none', polls: false, scheduleNative: false, notifyMe: false, boards: true, title: { max: 100, required: false }, like: false, hide: false, deleteComment: false, reply: false },
  quota: { postsPerDay: 25 },
  metadataSchema: z.object({ boardId: z.string().min(1, 'Choose a board'), boardSectionId: z.string().optional(), title: z.string().max(100).optional(), link: z.string().url().optional() }).passthrough(),
};

export const gbpRules: NetworkRules = {
  network: 'GOOGLE_BUSINESS', label: 'Google Business Profile',
  text: { max: 1500, counter: codepoints, required: true },
  media: { maxImages: 1, maxVideos: 1, mixImagesVideo: false, gif: false, image: { formats: ['jpeg', 'png'], maxBytes: 5e6, minW: 400 }, video: { formats: ['mp4'], maxBytes: 75e6, minS: 1, maxS: 30 } },
  features: { firstComment: false, location: false, userTags: false, linkPreviewEditable: 'none', polls: false, scheduleNative: false, notifyMe: false, cta: ['NONE', 'BOOK', 'ORDER', 'SHOP', 'LEARN_MORE', 'SIGN_UP', 'CALL'], like: false, hide: false, deleteComment: false, reply: true },
  quota: { postsPerDay: 50 },
  metadataSchema: z.object({
    topicType: z.enum(['STANDARD', 'EVENT', 'OFFER']).default('STANDARD'),
    cta: z.object({ actionType: z.enum(['NONE', 'BOOK', 'ORDER', 'SHOP', 'LEARN_MORE', 'SIGN_UP', 'CALL']), url: z.string().url().optional() }).optional(),
    event: z.object({ title: z.string().max(58), start: z.string().datetime(), end: z.string().datetime() }).optional(),
    offer: z.object({ couponCode: z.string().max(58).optional(), redeemOnlineUrl: z.string().url().optional(), terms: z.string().max(5000).optional() }).optional(),
    languageCode: z.string().optional(),
  }).passthrough().superRefine((v, ctx) => {
    if ((v.topicType === 'EVENT' || v.topicType === 'OFFER') && !v.event) ctx.addIssue({ code: 'custom', path: ['event'], message: 'Event/Offer posts need a title and dates' });
    if (v.cta && v.cta.actionType !== 'NONE' && v.cta.actionType !== 'CALL' && !v.cta.url) ctx.addIssue({ code: 'custom', path: ['cta', 'url'], message: 'Button needs a URL' });
  }),
};

export const blueskyRules: NetworkRules = {
  network: 'BLUESKY', label: 'Bluesky',
  text: { max: 300, counter: graphemes },
  thread: { maxParts: 25 },
  media: { maxImages: 4, maxVideos: 1, mixImagesVideo: false, gif: true, image: { formats: ['jpeg', 'png', 'webp', 'gif'], maxBytes: 950_000 }, video: { formats: ['mp4', 'mov', 'webm'], maxBytes: 100e6, minS: 1, maxS: 180 }, altTextMax: 2000 },
  features: { firstComment: false, location: false, userTags: false, linkPreviewEditable: 'full', polls: false, scheduleNative: false, notifyMe: false, like: true, hide: true, deleteComment: false, reply: true },
  quota: { note: '1,666 creates per hour per account' },
  metadataSchema: z.object({ langs: z.array(z.string()).optional(), replyControl: z.enum(['everyone', 'nobody', 'mention', 'following', 'follower']).optional(), selfLabels: z.array(z.string()).optional() }).passthrough(),
};

export const mastodonRules: NetworkRules = {
  network: 'MASTODON', label: 'Mastodon',
  text: { max: ctx => ctx.channel.meta.maxChars ?? 500, counter: (t, ctx) => mastodonLength(t, ctx.channel.meta.charsPerUrl ?? 23) },
  thread: { maxParts: 25 },
  media: { maxImages: 4, maxVideos: 1, mixImagesVideo: false, gif: true, image: { formats: ['jpeg', 'png', 'gif', 'webp', 'heic', 'avif'], maxBytes: 16e6 }, video: { formats: ['mp4', 'mov', 'webm', 'm4v'], maxBytes: 99e6, minS: 1, maxS: 3600 }, altTextMax: 1500 },
  features: { firstComment: false, location: false, userTags: false, linkPreviewEditable: 'none', polls: true, scheduleNative: true, notifyMe: false, contentWarning: true, visibility: ['public', 'unlisted', 'private', 'direct'], like: true, hide: false, deleteComment: false, reply: true },
  quota: { postsPerDay: 100 },
  metadataSchema: z.object({ visibility: z.enum(['public', 'unlisted', 'private', 'direct']).optional(), threadVisibility: z.enum(['public', 'unlisted', 'private', 'direct']).optional(), spoilerText: z.string().max(200).optional(), sensitive: z.boolean().optional(), language: z.string().length(2).optional(), poll: z.object({ options: z.array(z.string().max(50)).min(2).max(4), expiresInSec: z.number().min(300).max(2629746).default(86400), multiple: z.boolean().optional() }).optional() }).passthrough(),
};

export const startPageRules: NetworkRules = {
  network: 'START_PAGE', label: 'Start Page',
  text: { max: 2000, counter: codepoints },
  media: { maxImages: 1, maxVideos: 0, mixImagesVideo: false, gif: false, image: { formats: IMG, maxBytes: 10e6 } },
  features: { firstComment: false, location: false, userTags: false, linkPreviewEditable: 'none', polls: false, scheduleNative: false, notifyMe: false, like: false, hide: false, deleteComment: false, reply: false },
  quota: {},
  metadataSchema: z.object({ link: z.string().url().optional() }).passthrough(),
};

// DEV.to (Forem) — long-form Markdown articles rather than short social posts. The post text is the
// article body_markdown; a title is required and lives in metadata, plus up to 4 tags, an optional
// series and a canonical URL. One optional cover image (main_image). No native comments/polls API here.
export const devtoRules: NetworkRules = {
  network: 'DEVTO', label: 'DEV.to',
  text: { max: 250000, counter: codepoints },
  media: { maxImages: 1, maxVideos: 0, mixImagesVideo: false, gif: false, image: { formats: ['jpeg', 'png', 'webp', 'gif'], maxBytes: 25e6 } },
  features: { firstComment: false, location: false, userTags: false, linkPreviewEditable: 'none', polls: false, scheduleNative: false, notifyMe: false, title: { max: 250, required: true }, like: false, hide: false, deleteComment: false, reply: false },
  quota: { note: 'Article publishing via the Forem API key' },
  metadataSchema: z.object({ title: z.string().min(1).max(250), tags: z.array(z.string().regex(/^[a-z0-9]+$/i)).max(4).optional(), series: z.string().max(150).optional(), canonicalUrl: z.string().url().optional(), published: z.boolean().optional() }).passthrough(),
};

export const RULES: Record<string, NetworkRules> = {
  FACEBOOK: facebookRules, INSTAGRAM: instagramRules, THREADS: threadsRules, X: xRules, LINKEDIN: linkedinRules, TIKTOK: tiktokRules,
  YOUTUBE: youtubeRules, PINTEREST: pinterestRules, GOOGLE_BUSINESS: gbpRules, BLUESKY: blueskyRules, MASTODON: mastodonRules, DEVTO: devtoRules, START_PAGE: startPageRules,
};
export const rulesFor = (network: string): NetworkRules => { const r = RULES[network]; if (!r) throw new Error(`No rules for ${network}`); return r; };
