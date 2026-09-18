import { describe, expect, it } from 'vitest';
import { instagramRules, xRules, linkedinRules, threadsRules, gbpRules } from './rules.js';
import { hasErrors, validateTarget } from './validate.js';

const ctx = (metadata: any = {}, media: any[] = []) => ({ channel: { meta: {}, subtype: 'x' }, metadata, media });
const img = (i = 1) => ({ assetId: `a${i}`, kind: 'image' as const, mime: 'image/jpeg', width: 1080, height: 1350, bytes: 500_000 });
const vid = (s: number) => ({ assetId: 'v', kind: 'video' as const, mime: 'video/mp4', width: 1080, height: 1920, durationMs: s * 1000, bytes: 50e6 });

describe('validateTarget', () => {
  it('X weighted length counts URLs as 23', () => {
    // Literal length is well over 280, but the URL is weighted as 23 so the post is valid.
    const text = 'a'.repeat(250) + ' https://example.com/a/very/long/path/that/would/exceed/the/limit/if/counted/literally';
    expect(text.length).toBeGreaterThan(280);
    expect(hasErrors(validateTarget(xRules, { text, media: [] }, ctx()))).toBe(false);
    expect(hasErrors(validateTarget(xRules, { text: 'a'.repeat(281), media: [] }, ctx()))).toBe(true);
  });
  it('Instagram requires media and caps hashtags', () => {
    expect(validateTarget(instagramRules, { text: 'hi', media: [] }, ctx()).map(i => i.message)).toContain('Instagram requires an image or video');
    const tags = Array.from({ length: 31 }, (_, i) => `#t${i}`).join(' ');
    expect(hasErrors(validateTarget(instagramRules, { text: tags, media: [img()] }, ctx({}, [img()])))).toBe(true);
  });
  it('Instagram reel must be a single video within duration', () => {
    expect(hasErrors(validateTarget(instagramRules, { text: '', media: [img()], metadata: { postType: 'reel' } }, ctx({ postType: 'reel' }, [img()])))).toBe(true);
    expect(hasErrors(validateTarget(instagramRules, { text: '', media: [vid(30)], metadata: { postType: 'reel' } }, ctx({ postType: 'reel' }, [vid(30)])))).toBe(false);
    expect(hasErrors(validateTarget(instagramRules, { text: '', media: [vid(70)], metadata: { postType: 'story' } }, ctx({ postType: 'story' }, [vid(70)])))).toBe(true);
  });
  it('LinkedIn allows 20 images and one document', () => {
    expect(hasErrors(validateTarget(linkedinRules, { text: 'x', media: Array.from({ length: 20 }, (_, i) => img(i)) }, ctx()))).toBe(false);
    expect(hasErrors(validateTarget(linkedinRules, { text: 'x', media: Array.from({ length: 21 }, (_, i) => img(i)) }, ctx()))).toBe(true);
  });
  it('Threads: max 5 links and 500 chars', () => {
    const links = Array.from({ length: 6 }, (_, i) => `https://e${i}.com`).join(' ');
    expect(hasErrors(validateTarget(threadsRules, { text: links, media: [] }, ctx()))).toBe(true);
  });
  it('GBP: button needs URL, event needs dates', () => {
    expect(hasErrors(validateTarget(gbpRules, { text: 'Sale!', media: [], metadata: { topicType: 'STANDARD', cta: { actionType: 'LEARN_MORE' } } }, ctx({ topicType: 'STANDARD', cta: { actionType: 'LEARN_MORE' } })))).toBe(true);
    expect(hasErrors(validateTarget(gbpRules, { text: 'Sale!', media: [], metadata: { topicType: 'EVENT' } }, ctx({ topicType: 'EVENT' })))).toBe(true);
  });
});
