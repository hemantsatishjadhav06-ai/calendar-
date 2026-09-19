const MONTHS = [
    'january',
    'february',
    'march',
    'april',
    'may',
    'june',
    'july',
    'august',
    'september',
    'october',
    'november',
    'december',
] as const;

export type DateJump = { yyyymm: string; label: string };

function build(year: number, monthIndex: number): DateJump {
    const mm = String(monthIndex + 1).padStart(2, '0');

    return {
        yyyymm: `${year}-${mm}`,
        label: `${MONTHS[monthIndex][0].toUpperCase()}${MONTHS[monthIndex].slice(1)} ${year}`,
    };
}

export function parseDateJump(query: string, now: Date): DateJump | null {
    const q = query.trim().toLowerCase();
    if (q.length === 0) {
        return null;
    }

    if (q === 'today' || q === 'tomorrow') {
        return build(now.getFullYear(), now.getMonth());
    }

    const iso = q.match(/^(\d{4})[-/](\d{1,2})$/);
    if (iso) {
        const month = Number(iso[2]);
        if (month >= 1 && month <= 12) {
            return build(Number(iso[1]), month - 1);
        }

        return null;
    }

    const words = q.match(/^([a-z]+)(?:\s+(\d{4}))?$/);
    if (words) {
        const monthIndex = MONTHS.findIndex(
            (m) => m === words[1] || m.startsWith(words[1]),
        );
        if (monthIndex !== -1 && words[1].length >= 3) {
            const year = words[2] ? Number(words[2]) : now.getFullYear();

            return build(year, monthIndex);
        }
    }

    return null;
}
