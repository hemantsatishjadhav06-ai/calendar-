import { Deferred, Head, router, usePage } from '@inertiajs/react';
import { useState } from 'react';
import { toast } from 'sonner';

import WorkspaceSettingsController from '@/actions/App/Http/Controllers/Settings/WorkspaceSettingsController';
import WorkspaceController from '@/actions/App/Http/Controllers/WorkspaceController';
import Heading from '@/components/common/heading';
import InviteMemberDialog from '@/components/settings/invite-member-dialog';
import type { Invitation, Member } from '@/components/settings/member-types';
import MembersTable from '@/components/settings/members-table';
import PendingInvitationsTable from '@/components/settings/pending-invitations-table';
import RemoveMemberDialog from '@/components/settings/remove-member-dialog';
import TransferOwnershipDialog from '@/components/settings/transfer-ownership-dialog';
import { MembersSkeleton } from '@/components/skeletons/members-skeleton';
import { removeById, replaceById } from '@/lib/optimistic';

type Props = {
    members?: Member[];
    pendingInvitations: Invitation[];
    canManage: boolean;
    availableRoles: string[];
};

export default function WorkspaceMembers({
    members,
    pendingInvitations,
    canManage,
    availableRoles,
}: Props) {
    const { workspaces } = usePage().props;
    const isOwner = workspaces.current?.role === 'owner';
    const workspaceId = workspaces.current?.id ?? '';

    const [memberToRemove, setMemberToRemove] = useState<Member | null>(null);
    const [memberToPromote, setMemberToPromote] = useState<Member | null>(null);

    const handleUpdateRole = (memberId: string, role: string) => {
        router.patch(
            WorkspaceSettingsController.updateMemberRole.url(memberId),
            { role },
            {
                preserveScroll: true,
                optimistic: (props) => ({
                    members: replaceById(
                        (props as { members?: Member[] }).members,
                        memberId,
                        (member) => ({ ...member, role }),
                    ),
                }),
                onSuccess: () => toast.success('Member role updated'),
            },
        );
    };

    const confirmRemove = () => {
        if (!memberToRemove) {
            return;
        }

        const removedId = memberToRemove.id;

        router.delete(WorkspaceSettingsController.removeMember.url(removedId), {
            preserveScroll: true,
            optimistic: (props) => ({
                members: removeById(
                    (props as { members?: Member[] }).members,
                    removedId,
                ),
            }),
            onSuccess: () => {
                toast.success('Member removed');
                setMemberToRemove(null);
            },
            onError: () => setMemberToRemove(null),
        });
    };

    const confirmTransfer = () => {
        if (!memberToPromote) {
            return;
        }

        router.post(
            WorkspaceController.transferOwnership.url(workspaceId),
            { membership_id: memberToPromote.id },
            {
                preserveScroll: true,
                onSuccess: () => {
                    toast.success('Ownership transferred');
                    setMemberToPromote(null);
                },
                onError: () => setMemberToPromote(null),
            },
        );
    };

    const handleCancelInvitation = (invitationId: string) => {
        router.delete(
            WorkspaceSettingsController.cancelInvitation.url(invitationId),
            {
                preserveScroll: true,
                optimistic: (props) => ({
                    pendingInvitations: removeById(
                        (props as { pendingInvitations?: Invitation[] })
                            .pendingInvitations,
                        invitationId,
                    ),
                }),
                onSuccess: () => toast.success('Invitation cancelled'),
            },
        );
    };

    return (
        <>
            <Head title="Workspace members" />

            <div className="space-y-6">
                <div className="flex items-center justify-between gap-4">
                    <Heading
                        variant="small"
                        title="Members"
                        description="Manage workspace members and their roles"
                    />
                    {canManage && (
                        <InviteMemberDialog availableRoles={availableRoles} />
                    )}
                </div>

                <Deferred data="members" fallback={<MembersSkeleton />}>
                    <MembersTable
                        members={members ?? []}
                        canManage={canManage}
                        isOwner={isOwner}
                        availableRoles={availableRoles}
                        onUpdateRole={handleUpdateRole}
                        onRemove={setMemberToRemove}
                        onTransfer={setMemberToPromote}
                    />
                </Deferred>

                <PendingInvitationsTable
                    invitations={pendingInvitations}
                    canManage={canManage}
                    onCancel={handleCancelInvitation}
                />
            </div>

            <RemoveMemberDialog
                member={memberToRemove}
                onClose={() => setMemberToRemove(null)}
                onConfirm={confirmRemove}
            />

            <TransferOwnershipDialog
                member={memberToPromote}
                onClose={() => setMemberToPromote(null)}
                onConfirm={confirmTransfer}
            />
        </>
    );
}

WorkspaceMembers.layout = {
    breadcrumbs: [
        {
            title: 'Workspace settings',
            href: WorkspaceSettingsController.showOverview().url,
        },
        {
            title: 'Members',
            href: WorkspaceSettingsController.showMembers().url,
        },
    ],
};
