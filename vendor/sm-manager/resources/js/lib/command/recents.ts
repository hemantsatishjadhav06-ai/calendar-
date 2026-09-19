export type RecentItem = {
    id: string;
    kind: 'post' | 'page';
    label: string;
    href: string;
};

const STORAGE_KEY = 'shoutrrr:command-recents';
const MAX = 6;

export function pushRecent(
    list: RecentItem[],
    item: RecentItem,
    max: number,
): RecentItem[] {
    return [item, ...list.filter((r) => r.id !== item.id)].slice(0, max);
}

export function readRecents(): RecentItem[] {
    if (typeof localStorage === 'undefined') {
        return [];
    }
    try {
        const raw = localStorage.getItem(STORAGE_KEY);

        return raw ? (JSON.parse(raw) as RecentItem[]) : [];
    } catch {
        return [];
    }
}

export function recordRecent(item: RecentItem): void {
    if (typeof localStorage === 'undefined') {
        return;
    }
    try {
        localStorage.setItem(
            STORAGE_KEY,
            JSON.stringify(pushRecent(readRecents(), item, MAX)),
        );
    } catch {
        // Ignore storage failures (private mode, quota). Recents are best-effort.
    }
}
