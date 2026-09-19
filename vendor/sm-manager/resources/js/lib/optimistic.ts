type HasId = { id: string };

/** Remove the row with the given id. Tolerates an undefined (deferred) list. */
export function removeById<T extends HasId>(
    list: T[] | undefined,
    id: string,
): T[] {
    return (list ?? []).filter((row) => row.id !== id);
}

/** Replace the row with the given id by mapping it through `update`. */
export function replaceById<T extends HasId>(
    list: T[] | undefined,
    id: string,
    update: (row: T) => T,
): T[] {
    return (list ?? []).map((row) => (row.id === id ? update(row) : row));
}

/** Update the row in place if present, otherwise append it. */
export function upsertById<T extends HasId>(
    list: T[] | undefined,
    row: T,
): T[] {
    const current = list ?? [];
    return current.some((r) => r.id === row.id)
        ? current.map((r) => (r.id === row.id ? row : r))
        : [...current, row];
}

/** Move an item between indices (immutably). */
export function reorder<T>(
    list: T[] | undefined,
    from: number,
    to: number,
): T[] {
    const next = [...(list ?? [])];
    const [moved] = next.splice(from, 1);
    if (moved !== undefined) {
        next.splice(to, 0, moved);
    }
    return next;
}
