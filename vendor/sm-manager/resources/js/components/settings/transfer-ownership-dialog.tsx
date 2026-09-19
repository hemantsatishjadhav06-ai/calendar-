import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';

import type { Member } from './member-types';

export default function TransferOwnershipDialog({
    member,
    onClose,
    onConfirm,
}: {
    member: Member | null;
    onClose: () => void;
    onConfirm: () => void;
}) {
    return (
        <Dialog
            open={member !== null}
            onOpenChange={(open) => !open && onClose()}
        >
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Transfer ownership</DialogTitle>
                    <DialogDescription>
                        Make {member?.name} the owner of this workspace? You
                        will be demoted to admin and lose owner permissions.
                    </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                    <Button type="button" variant="outline" onClick={onClose}>
                        Cancel
                    </Button>
                    <Button type="button" onClick={onConfirm}>
                        Transfer ownership
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
