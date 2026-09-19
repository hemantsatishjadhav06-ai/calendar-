import { describe, expect, it } from 'vitest';

import { removeById, replaceById, reorder, upsertById } from '../optimistic';

type Row = { id: string; name: string };
const rows: Row[] = [
    { id: 'a', name: 'A' },
    { id: 'b', name: 'B' },
    { id: 'c', name: 'C' },
];

describe('optimistic helpers', () => {
    it('removeById drops the matching row', () => {
        expect(removeById(rows, 'b')).toEqual([rows[0], rows[2]]);
    });

    it('removeById tolerates an undefined list', () => {
        expect(removeById(undefined, 'b')).toEqual([]);
    });

    it('replaceById swaps the matching row', () => {
        const out = replaceById(rows, 'b', (r) => ({ ...r, name: 'B2' }));
        expect(out[1]).toEqual({ id: 'b', name: 'B2' });
    });

    it('upsertById updates when present', () => {
        const out = upsertById(rows, { id: 'b', name: 'B3' });
        expect(out).toHaveLength(3);
        expect(out[1].name).toBe('B3');
    });

    it('upsertById appends when absent', () => {
        const out = upsertById(rows, { id: 'd', name: 'D' });
        expect(out).toHaveLength(4);
        expect(out[3].id).toBe('d');
    });

    it('reorder moves an item from one index to another', () => {
        expect(reorder(rows, 0, 2).map((r) => r.id)).toEqual(['b', 'c', 'a']);
    });
});
