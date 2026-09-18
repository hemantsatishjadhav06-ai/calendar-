import { describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { open, seal } from './crypto.js';

describe('seal/open', () => {
  it('round-trips and detects tampering', () => {
    const dek = randomBytes(32);
    const blob = seal('EAAB.secret.token', dek);
    expect(open(blob, dek)).toBe('EAAB.secret.token');
    blob[blob.length - 1] ^= 0xff;
    expect(() => open(blob, dek)).toThrow();
  });
});
