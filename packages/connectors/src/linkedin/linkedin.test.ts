import { describe, expect, it } from 'vitest';
import { littleText } from './linkedin.js';

describe('LinkedIn little text', () => {
  it('escapes reserved characters and keeps hashtags', () => {
    expect(littleText('Hello (world) #launch @Acme 100% [beta]')).toBe('Hello \\(world\\) #launch \\@Acme 100% \\[beta\\]');
  });
  it('injects organization mentions', () => {
    expect(littleText('Thanks @Acme Inc for hosting', [{ display: 'Acme Inc', urn: 'urn:li:organization:123' }])).toBe('Thanks @[Acme Inc](urn:li:organization:123) for hosting');
  });
});
