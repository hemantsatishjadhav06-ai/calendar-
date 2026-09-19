import { describe, expect, it } from 'vitest';

import { canDismissOnboarding } from '../getting-started-card';

describe('canDismissOnboarding', () => {
    it('allows dismissing only after an account is connected', () => {
        const base = {
            welcomed: true,
            dismissed: false,
            complete: false,
            steps: [
                {
                    key: 'connect_account',
                    label: 'Connect an account',
                    done: false,
                    href: '/accounts',
                    clickToComplete: false,
                },
            ],
        };

        expect(canDismissOnboarding(base)).toBe(false);
        expect(
            canDismissOnboarding({
                ...base,
                steps: [{ ...base.steps[0], done: true }],
            }),
        ).toBe(true);
    });
});
