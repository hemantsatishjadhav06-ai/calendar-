import confetti from 'canvas-confetti';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { celebrate } from '../celebrate';

vi.mock('canvas-confetti', () => ({ default: vi.fn() }));

const confettiMock = vi.mocked(confetti);

describe('celebrate', () => {
    beforeEach(() => {
        confettiMock.mockClear();
    });

    it('fires the layered burst recipe', () => {
        celebrate();
        expect(confettiMock).toHaveBeenCalledTimes(5);
    });

    it('opts out under reduced motion and tags brand colours on every burst', () => {
        celebrate();
        for (const [opts] of confettiMock.mock.calls) {
            expect(opts?.disableForReducedMotion).toBe(true);
            expect(opts?.colors).toContain('#22c55e');
            expect(opts?.particleCount).toBeGreaterThan(0);
        }
    });
});
