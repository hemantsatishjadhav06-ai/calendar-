export interface ImageSpec { format: 'jpeg' | 'png' | 'webp'; maxW?: number; minW?: number; maxBytes: number; aspect?: [number, number]; quality?: number }
export interface VideoSpec { w?: number; h?: number; maxW?: number; pad?: boolean; fps: number; vBitrateK: number; aBitrateK: number; gop: number; maxDurationS?: number }

export const IMAGE_SPECS: Record<string, ImageSpec> = {
  ig_feed_jpeg: { format: 'jpeg', maxW: 1440, minW: 320, maxBytes: 8e6, aspect: [0.8, 1.91], quality: 88 },
  ig_story_jpeg: { format: 'jpeg', maxW: 1080, maxBytes: 8e6, aspect: [0.5625, 0.5625], quality: 88 },
  th_image: { format: 'jpeg', maxW: 1440, maxBytes: 8e6, quality: 88 },
  fb_feed: { format: 'jpeg', maxW: 2048, maxBytes: 10e6, quality: 90 },
  fb_gif: { format: 'webp', maxBytes: 8e6 },
  fb_story_image: { format: 'jpeg', maxW: 1080, maxBytes: 8e6, aspect: [0.5625, 0.5625] },
  x_image: { format: 'jpeg', maxW: 4096, maxBytes: 5e6, quality: 88 },
  x_gif: { format: 'webp', maxBytes: 15e6 },
  li_image: { format: 'jpeg', maxW: 2048, maxBytes: 8e6, quality: 90 },
  li_link_thumb: { format: 'jpeg', maxW: 1200, maxBytes: 8e6, aspect: [1.91, 1.91] },
  tt_photo: { format: 'jpeg', maxW: 1080, maxBytes: 20e6, quality: 90 },
  yt_thumb: { format: 'jpeg', maxW: 1280, maxBytes: 2e6, aspect: [1.7778, 1.7778] },
  pin_image: { format: 'jpeg', maxW: 2000, maxBytes: 20e6, quality: 90 },
  gbp_photo: { format: 'jpeg', maxW: 1200, minW: 400, maxBytes: 5e6, aspect: [1.3333, 1.3333] },
  bsky_image: { format: 'jpeg', maxW: 2000, maxBytes: 950_000, quality: 85 },
  masto_image: { format: 'jpeg', maxW: 3840, maxBytes: 16e6, quality: 90 },
};

export const VIDEO_SPECS: Record<string, VideoSpec> = {
  ig_reel: { w: 1080, h: 1920, pad: false, fps: 30, vBitrateK: 8000, aBitrateK: 128, gop: 60, maxDurationS: 900 },
  ig_story_video: { w: 1080, h: 1920, pad: true, fps: 30, vBitrateK: 6000, aBitrateK: 128, gop: 60, maxDurationS: 60 },
  ig_carousel_video: { w: 1080, h: 1350, pad: false, fps: 30, vBitrateK: 6000, aBitrateK: 128, gop: 60, maxDurationS: 60 },
  fb_video: { maxW: 1920, fps: 30, vBitrateK: 8000, aBitrateK: 128, gop: 60 },
  fb_reel: { w: 1080, h: 1920, pad: false, fps: 30, vBitrateK: 8000, aBitrateK: 128, gop: 60, maxDurationS: 90 },
  fb_story_video: { w: 1080, h: 1920, pad: true, fps: 30, vBitrateK: 6000, aBitrateK: 128, gop: 60, maxDurationS: 60 },
  th_video: { maxW: 1920, fps: 30, vBitrateK: 8000, aBitrateK: 128, gop: 60, maxDurationS: 300 },
  x_video: { maxW: 1920, fps: 30, vBitrateK: 6000, aBitrateK: 128, gop: 60, maxDurationS: 140 },
  li_video: { maxW: 1920, fps: 30, vBitrateK: 8000, aBitrateK: 128, gop: 60 },
  tt_video: { w: 1080, h: 1920, pad: false, fps: 30, vBitrateK: 10000, aBitrateK: 192, gop: 60 },
  yt_video: { maxW: 3840, fps: 30, vBitrateK: 12000, aBitrateK: 192, gop: 60 },
  pin_video: { maxW: 1080, fps: 30, vBitrateK: 6000, aBitrateK: 128, gop: 60, maxDurationS: 900 },
  gbp_video: { maxW: 1280, fps: 30, vBitrateK: 4000, aBitrateK: 128, gop: 60, maxDurationS: 30 },
  bsky_video: { maxW: 1280, fps: 30, vBitrateK: 3000, aBitrateK: 96, gop: 60, maxDurationS: 180 },
  masto_video: { maxW: 1920, fps: 30, vBitrateK: 4000, aBitrateK: 128, gop: 60 },
};
