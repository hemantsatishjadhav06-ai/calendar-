import { Skeleton } from '@/components/ui/skeleton';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';

/**
 * Content-shaped placeholder for the deferred workspace member list. Mirrors
 * {@link MembersTable}'s `rounded-md border` frame and its Member / Role /
 * Joined columns — the `size-8` avatar paired with stacked name + email lines,
 * the role badge, and the joined date — so the streamed-in members swap in with
 * zero layout shift.
 */
export function MembersSkeleton() {
    return (
        <div className="rounded-md border">
            <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead>Member</TableHead>
                        <TableHead>Role</TableHead>
                        <TableHead>Joined</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {Array.from({ length: 4 }).map((_, i) => (
                        <TableRow key={i}>
                            <TableCell>
                                <div className="flex items-center gap-3">
                                    <Skeleton className="size-8 rounded-full" />
                                    <div className="min-w-0 space-y-1.5">
                                        <Skeleton className="h-4 w-32 rounded-md" />
                                        <Skeleton className="h-3.5 w-44 rounded-md" />
                                    </div>
                                </div>
                            </TableCell>
                            <TableCell>
                                <Skeleton className="h-6 w-20 rounded-full" />
                            </TableCell>
                            <TableCell>
                                <Skeleton className="h-4 w-24 rounded-md" />
                            </TableCell>
                        </TableRow>
                    ))}
                </TableBody>
            </Table>
        </div>
    );
}
