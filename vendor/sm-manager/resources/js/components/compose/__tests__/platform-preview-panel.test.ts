import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const source = () =>
    readFileSync(
        resolve(
            process.cwd(),
            'resources/js/components/compose/platform-preview-panel.tsx',
        ),
        'utf8',
    );

describe('platform preview panel', () => {
    it('wraps long unbroken preview text inside the post card', () => {
        expect(source()).toContain('wrap-anywhere');
        expect(source()).toContain('whitespace-pre-wrap');
    });
});
