import { describe, expect, it } from 'vitest';

import { ACCOUNT_GRID_CLASS } from '../index';

describe('accounts page layout', () => {
    it('limits account cards to two columns on large screens', () => {
        expect(ACCOUNT_GRID_CLASS).toContain('lg:grid-cols-2');
        expect(ACCOUNT_GRID_CLASS).not.toContain('lg:grid-cols-3');
    });
});
