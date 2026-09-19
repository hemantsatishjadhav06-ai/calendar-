import { Deferred, Head, Link } from '@inertiajs/react';

import PostingScheduleController from '@/actions/App/Http/Controllers/Posts/PostingScheduleController';
import WorkspaceSettingsController from '@/actions/App/Http/Controllers/Settings/WorkspaceSettingsController';
import { ScheduleEditor } from '@/components/queue/schedule-editor';
import { QueueSkeleton } from '@/components/skeletons/queue-skeleton';
import { normalizeSlots, type Slot } from '@/lib/queue/queue-schedule';

type Props = {
    timezone: string;
    slots?: Slot[];
    canManage: boolean;
};

export default function QueueIndex({ timezone, slots, canManage }: Props) {
    return (
        <>
            <Head title="Queue" />

            <div className="mx-auto w-full max-w-6xl space-y-5 px-4 pt-6 pb-16 sm:px-6">
                {/* Header — slots-independent, paints immediately */}
                <div className="flex flex-col gap-1">
                    <h1 className="text-[22px] leading-tight font-semibold tracking-tight">
                        Posting queue
                    </h1>
                    <p className="text-[13px] text-muted-foreground">
                        Queued posts go out at these times each week, in{' '}
                        <span className="font-medium text-foreground">
                            {timezone}
                        </span>{' '}
                        ·{' '}
                        <Link
                            href={
                                WorkspaceSettingsController.showOverview().url
                            }
                            className="font-medium text-foreground underline underline-offset-2 hover:no-underline"
                        >
                            change
                        </Link>
                    </p>
                </div>

                <Deferred data="slots" fallback={<QueueSkeleton />}>
                    <ScheduleEditor
                        key={normalizeSlots(slots ?? [])
                            .map((s) => `${s.weekday}:${s.hour}:${s.minute}`)
                            .join(',')}
                        initialSlots={normalizeSlots(slots ?? [])}
                        timezone={timezone}
                        canManage={canManage}
                    />
                </Deferred>
            </div>
        </>
    );
}

QueueIndex.layout = {
    breadcrumbs: [
        {
            title: 'Queue',
            href: PostingScheduleController.show().url,
        },
    ],
};
