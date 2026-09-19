import { Button } from '@/components/ui/button';

type Props = {
    saving: boolean;
    onSave: () => void;
    onDiscard: () => void;
};

/** Sticky bottom bar that appears when there are unsaved schedule changes. */
export function SaveBar({ saving, onSave, onDiscard }: Props) {
    return (
        <div className="sticky bottom-4 z-10 flex items-center justify-between gap-2 rounded-xl border border-border bg-card/95 px-3 py-2.5 shadow-lg backdrop-blur sm:gap-3 sm:px-4">
            <span className="min-w-0 truncate text-[12.5px] text-muted-foreground">
                Unsaved changes
            </span>
            <div className="flex shrink-0 items-center gap-2">
                <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-9 text-[12.5px] sm:h-8"
                    disabled={saving}
                    onClick={onDiscard}
                >
                    Discard
                </Button>
                <Button
                    size="sm"
                    className="h-9 px-4 text-[12.5px] sm:h-8"
                    disabled={saving}
                    onClick={onSave}
                >
                    {saving ? 'Saving…' : 'Save changes'}
                </Button>
            </div>
        </div>
    );
}
