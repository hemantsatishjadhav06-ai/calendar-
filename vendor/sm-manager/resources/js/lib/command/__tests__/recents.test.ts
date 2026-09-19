import { describe, expect, it } from 'vitest';

import { pushRecent, type RecentItem } from '../recents';

const item = (id: string): RecentItem => ({
    id,
    kind: 'post',
    label: `Post ${id}`,
    href: `/posts/${id}`,
});

describe('pushRecent', () => {
    it('prepends the newest item', () => {
        const result = pushRecent([item('a')], item('b'), 5);
        expect(result.map((r) => r.id)).toEqual(['b', 'a']);
    });

    it('dedupes by id, moving the existing item to the front', () => {
        const result = pushRecent([item('a'), item('b')], item('b'), 5);
        expect(result.map((r) => r.id)).toEqual(['b', 'a']);
    });

    it('caps the list at max', () => {
        const result = pushRecent(
            [item('a'), item('b'), item('c')],
            item('d'),
            3,
        );
        expect(result.map((r) => r.id)).toEqual(['d', 'a', 'b']);
    });
});
