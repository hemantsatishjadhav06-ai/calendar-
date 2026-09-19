<?php

declare(strict_types=1);

namespace App\Listeners;

use App\Models\User;
use Illuminate\Auth\Events\Login;

class SetCurrentWorkspaceOnLogin
{
    public function handle(Login $event): void
    {
        $user = $event->user;

        if (! $user instanceof User || $user->current_workspace_id) {
            return;
        }

        $membership = $user->workspaceMemberships()->first();

        if ($membership) {
            $user->forceFill(['current_workspace_id' => $membership->workspace_id])->save();
        }
    }
}
