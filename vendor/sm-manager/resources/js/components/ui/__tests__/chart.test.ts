import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('chart tooltip content', () => {
    it('keeps space between a series label and its value', () => {
        const source = readFileSync(
            resolve(process.cwd(), 'resources/js/components/ui/chart.tsx'),
            'utf8',
        );

        expect(source).toContain(
            'flex flex-1 justify-between gap-2 leading-none',
        );
    });
});
