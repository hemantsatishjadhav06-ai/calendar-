import { Head } from '@inertiajs/react';

import Heading from '@/components/common/heading';
import TextLink from '@/components/common/text-link';
import type { Connection } from '@/components/settings/manage-connected-accounts';
import ManageConnectedAccounts from '@/components/settings/manage-connected-accounts';
import { edit as editConnections } from '@/routes/connections';
import { request as passwordReset } from '@/routes/password';

type Props = {
    connections: Connection[];
    hasPassword: boolean;
};

export default function Connections({ connections, hasPassword }: Props) {
    return (
        <>
            <Head title="Connected accounts" />

            <h1 className="sr-only">Connected accounts</h1>

            <ManageConnectedAccounts connections={connections} />

            {!hasPassword && (
                <div className="space-y-6">
                    <Heading
                        variant="small"
                        title="Set a password"
                        description="Add a password to your account so you can also sign in without a connected provider"
                    />

                    <TextLink href={passwordReset()}>Set a password</TextLink>
                </div>
            )}
        </>
    );
}

Connections.layout = {
    breadcrumbs: [
        {
            title: 'Connected accounts',
            href: editConnections(),
        },
    ],
};
