<?php

declare(strict_types=1);

namespace App\Listeners;

use App\Models\McpGrantWorkspace;
use Laravel\Passport\Events\AccessTokenCreated;

/**
 * When Passport issues an access token (token exchange), find the pending workspace
 * binding the user recorded at consent (keyed by user + client) and stamp it with
 * the new token id, finalizing the token<->workspace binding.
 */
class BindWorkspaceToAccessToken
{
    public function handle(AccessTokenCreated $event): void
    {
        // SQLite does not support UPDATE … LIMIT, so we locate the pending row by
        // primary key first and then update by id.
        $pending = McpGrantWorkspace::query()
            ->where('user_id', $event->userId)
            ->where('client_id', $event->clientId)
            ->whereNull('access_token_id')
            ->latest()
            ->value('id');

        if ($pending === null) {
            return;
        }

        McpGrantWorkspace::where('id', $pending)
            ->update(['access_token_id' => $event->tokenId]);
    }
}
