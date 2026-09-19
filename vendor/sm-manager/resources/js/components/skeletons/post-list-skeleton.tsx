import { Skeleton } from '@/components/ui/skeleton';

/**
 * Content-shaped placeholder for the deferred Posts index list. Mirrors
 * {@link PostRow}'s bordered card and `grid-cols-[64px_1fr_auto]` row layout
 * (time rail, text + meta, status badge) so the streamed-in posts swap in with
 * zero layout shift.
 */
export function PostListSkeleton() {
    return (
        <div className="rounded-xl border border-border">
            {Array.from({ length: 6 }).map((_, i) => (
                <div
                    key={i}
                    className="grid grid-cols-[64px_1fr_auto] items-start gap-3 border-b border-border px-3 py-3 last:border-b-0 sm:grid-cols-[84px_1fr_auto] sm:gap-4"
                >
                    {/* Time rail */}
                    <div className="space-y-1.5 pt-0.5">
                        <Skeleton className="h-3 w-10 rounded-md" />
                        <Skeleton className="h-2.5 w-12 rounded-md" />
                    </div>

                    {/* Text + meta */}
                    <div className="min-w-0 space-y-2">
                        <Skeleton className="h-3.5 w-3/4 rounded-md" />
                        <Skeleton className="h-3.5 w-1/2 rounded-md" />
                        <div className="flex items-center gap-1.5 pt-0.5">
                            <Skeleton className="size-[18px] rounded-[5px]" />
                            <Skeleton className="h-2.5 w-16 rounded-md" />
                        </div>
                    </div>

                    {/* Status badge */}
                    <Skeleton className="h-5 w-16 rounded-full" />
                </div>
            ))}
        </div>
    );
}
