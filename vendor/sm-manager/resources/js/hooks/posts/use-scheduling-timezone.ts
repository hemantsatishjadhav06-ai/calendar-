import { usePage } from '@inertiajs/react';

import { userTz } from '@/lib/datetime/dayjs';

/**
 * The timezone all scheduling UI (calendar, time picker, now-line) operates in:
 * the current workspace's posting-schedule timezone, falling back to the
 * browser's tz only when there is no workspace context (e.g. before selection).
 */
export function useSchedulingTimezone(): string {
    const current = usePage().props.workspaces?.current;
    return current?.timezone || userTz();
}
