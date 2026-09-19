import type { ZodTypeAny } from 'zod';

export type Network = 'FACEBOOK' | 'INSTAGRAM' | 'THREADS' | 'X' | 'LINKEDIN' | 'TIKTOK' | 'YOUTUBE' | 'PINTEREST' | 'GOOGLE_BUSINESS' | 'BLUESKY' | 'MASTODON' | 'DEVTO' | 'DISCORD' | 'START_PAGE';

export interface MediaLite {
  assetId: string;
  kind: 'image' | 'gif' | 'video' | 'document';
  mime?: string;
  bytes?: number;
  width?: number;
  height?: number;
  durationMs?: number;
  altText?: string;
  order?: number;
  userTags?: { username: string; x?: number; y?: number; id?: string }[];
  cover?: { offsetMs?: number; assetId?: string };
  renditionKey?: string;
}

export interface RuleCtx {
  channel: { meta: Record<string, any>; subtype: string };
  metadata: Record<string, any>;
  media: MediaLite[];
  premium?: boolean;
}

export interface PostTypeDef { id: string; label: string; media: 'image' | 'video' | 'either' | 'none'; count?: [number, number] }

export interface NetworkRules {
  network: Network;
  label: string;
  text: {
    max: number | ((ctx: RuleCtx) => number);
    counter: (text: string, ctx: RuleCtx) => number;
    urlWeight?: number;
    hashtagsMax?: number;
    mentionsMax?: number;
    linksMax?: number;
    required?: boolean;
  };
  thread?: { maxParts: number };
  media: {
    maxImages: number;
    maxVideos: number;
    mixImagesVideo: boolean;
    gif: boolean;
    requireMedia?: boolean;
    image: { formats: string[]; maxBytes: number; aspect?: [number, number]; minW?: number };
    video?: { formats: string[]; maxBytes: number; minS: number; maxS: number | ((ctx: RuleCtx) => number); aspect?: [number, number] };
    document?: { maxBytes: number; maxPages: number };
    altTextMax?: number;
  };
  postTypes?: PostTypeDef[];
  features: {
    firstComment: boolean;
    location: boolean;
    userTags: boolean;
    linkPreviewEditable: 'none' | 'full' | 'domainVerified';
    polls: boolean;
    scheduleNative: boolean;
    notifyMe: boolean;
    shopGrid?: boolean;
    boards?: boolean;
    title?: { max: number; required: boolean };
    contentWarning?: boolean;
    visibility?: string[];
    cta?: string[];
    like?: boolean; hide?: boolean; deleteComment?: boolean; reply?: boolean;
  };
  quota: { postsPerDay?: number; note?: string };
  metadataSchema: ZodTypeAny;
}

export interface Issue { level: 'error' | 'warn'; field: string; message: string }

export interface TargetDraft {
  text: string;
  media: MediaLite[];
  thread?: { text: string; media: MediaLite[] }[];
  metadata?: Record<string, any>;
  firstComment?: string;
}
