import { describe, expect, it } from 'vitest';

import { parseDateJump } from '../parse-date-jump';

const now = new Date('2026-06-19T00:00:00Z');

describe('parseDateJump', () => {
    it('parses a full month name with explicit year', () => {
        expect(parseDateJump('june 2027', now)).toEqual({
            yyyymm: '2027-06',
            label: 'June 2027',
        });
    });

    it('parses a 3-letter month, defaulting the year to now', () => {
        expect(parseDateJump('jan', now)).toEqual({
            yyyymm: '2026-01',
            label: 'January 2026',
        });
    });

    it('parses an ISO-ish YYYY-MM', () => {
        expect(parseDateJump('2025-03', now)).toEqual({
            yyyymm: '2025-03',
            label: 'March 2025',
        });
    });

    it('maps today and tomorrow to the current month', () => {
        expect(parseDateJump('today', now)?.yyyymm).toBe('2026-06');
        expect(parseDateJump('tomorrow', now)?.yyyymm).toBe('2026-06');
    });

    it('returns null for non-date queries', () => {
        expect(parseDateJump('launch post', now)).toBeNull();
        expect(parseDateJump('', now)).toBeNull();
    });
});
