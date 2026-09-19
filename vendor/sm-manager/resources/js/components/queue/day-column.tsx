import { formatTime, type Slot, timesForDay } from '@/lib/queue/queue-schedule';
import { cn } from '@/lib/utils';

import { AddTimePopover } from './add-time-popover';

type Props = {
    weekday: number;
    label: string;
    slots: Slot[];
    isToday: boolean;
    canManage: boolean;
    onAdd: (hour: number, minute: number) => void;
    onRemove: (hour: number, minute: number) => void;
};

/** A single day card in the weekly schedule board, showing time slots for that day. */
export function DayColumn({
    weekday,
    label,
    slots,
    isToday,
    canManage,
    onAdd,
    onRemove,
}: Props) {
    const times = timesForDay(slots, weekday);

    return (
        <div
            className={cn(
                'flex flex-col gap-2 rounded-xl border bg-card p-3 transition-colors',
                times.length === 0
                    ? 'border-dashed border-border'
                    : 'border-border',
                isToday && 'ring-1 ring-primary/40',
            )}
        >
            <div className="flex items-center justify-between">
                <span
                    className={cn(
                        'text-[12.5px] font-semibold',
                        isToday ? 'text-primary' : 'text-foreground',
                    )}
                >
                    {label}
                </span>
                {times.length > 0 && (
                    <span className="text-[11px] text-muted-foreground tabular-nums">
                        {times.length}
                    </span>
                )}
            </div>

            <div className="flex flex-col gap-1.5">
                {times.length === 0 && (
                    <span className="py-1 text-[12px] text-muted-foreground/70">
                        No times
                    </span>
                )}
                {times.map(({ hour, minute }) => (
                    <span
                        key={`${hour}:${minute}`}
                        className="group/slot inline-flex items-center justify-between rounded-md bg-primary/10 py-1 pr-1 pl-2.5 text-[12.5px] font-medium text-foreground tabular-nums"
                    >
                        {formatTime(hour, minute)}
                        {canManage && (
                            <button
                                type="button"
                                aria-label={`Remove ${label} ${formatTime(hour, minute)}`}
                                onClick={() => onRemove(hour, minute)}
                                className="grid size-5 place-items-center rounded text-muted-foreground transition-colors hover:bg-primary/20 hover:text-foreground"
                            >
                                ×
                            </button>
                        )}
                    </span>
                ))}
                {canManage && <AddTimePopover onAdd={onAdd} />}
            </div>
        </div>
    );
}
