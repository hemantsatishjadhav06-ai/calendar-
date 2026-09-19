<?php

declare(strict_types=1);

namespace App\Mcp\Tools\Concerns;

use App\Models\AccountSet;
use App\Models\ConnectedAccount;

trait ManagesAccountSets
{
    /**
     * Filter the given ids to ConnectedAccounts belonging to the workspace.
     *
     * @param  list<string>  $ids
     * @return list<string>
     */
    protected function scopedAccountIds(string $workspaceId, array $ids): array
    {
        return array_values(
            ConnectedAccount::withoutGlobalScopes()
                ->where('workspace_id', $workspaceId)
                ->whereIn('id', $ids)
                ->pluck('id')
                ->map(fn (mixed $id): string => (string) $id)
                ->all()
        );
    }

    /**
     * @return array{id: string, name: string, connected_account_ids: list<string>}
     */
    protected function view(AccountSet $set): array
    {
        return [
            'id' => $set->id,
            'name' => $set->name,
            'connected_account_ids' => array_values(
                $set->accounts()->pluck('connected_accounts.id')->map(fn (mixed $id): string => (string) $id)->all()
            ),
        ];
    }
}
