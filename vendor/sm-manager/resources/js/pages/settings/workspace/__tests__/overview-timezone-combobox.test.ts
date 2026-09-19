import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const source = () =>
    readFileSync(
        resolve(
            process.cwd(),
            'resources/js/pages/settings/workspace/overview.tsx',
        ),
        'utf8',
    );

describe('workspace timezone selector', () => {
    it('uses a searchable shadcn combobox instead of a plain select', () => {
        expect(source()).toContain(
            '<Popover open={open} onOpenChange={setOpen}>',
        );
        expect(source()).toContain(
            '<CommandInput placeholder="Search timezones..."',
        );
        expect(source()).toContain(
            '<CommandEmpty>No timezone found.</CommandEmpty>',
        );
        expect(source()).toContain('role="combobox"');
        expect(source()).not.toContain("from '@/components/ui/select'");
        expect(source()).not.toContain('<Select');
    });
});
