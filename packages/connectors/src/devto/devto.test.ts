import { describe, expect, it } from 'vitest';
import { buildArticle } from './devto.js';

describe('DEV.to buildArticle', () => {
  it('carries title, body and defaults published to true', () => {
    const a = buildArticle('My title', '# Body', {});
    expect(a.title).toBe('My title');
    expect(a.body_markdown).toBe('# Body');
    expect(a.published).toBe(true);
    expect('tags' in a).toBe(false);
    expect('main_image' in a).toBe(false);
  });

  it('honours published:false (draft)', () => {
    expect(buildArticle('t', '', { published: false }).published).toBe(false);
  });

  it('caps tags at four and includes optional fields', () => {
    const a = buildArticle('t', 'b', { tags: ['a', 'b', 'c', 'd', 'e'], series: 'S', canonicalUrl: 'https://x.dev/p' }, 'https://img/cover.png');
    expect(a.tags).toEqual(['a', 'b', 'c', 'd']);
    expect(a.series).toBe('S');
    expect(a.canonical_url).toBe('https://x.dev/p');
    expect(a.main_image).toBe('https://img/cover.png');
  });

  it('omits empty tag arrays and unset optionals', () => {
    const a = buildArticle('t', 'b', { tags: [] });
    expect('tags' in a).toBe(false);
    expect('series' in a).toBe(false);
    expect('canonical_url' in a).toBe(false);
  });
});
