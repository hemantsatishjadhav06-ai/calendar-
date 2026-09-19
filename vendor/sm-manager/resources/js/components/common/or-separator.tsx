import type { ReactNode } from 'react';

import { Separator } from '@/components/ui/separator';

type Props = {
    children?: ReactNode;
};

export default function OrSeparator({
    children = 'Or continue with email',
}: Props) {
    return (
        <div className="relative my-6">
            <div className="absolute inset-0 flex items-center">
                <Separator className="w-full" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-background px-2 text-muted-foreground">
                    {children}
                </span>
            </div>
        </div>
    );
}
