<?php

declare(strict_types=1);

namespace App\Policies;

use App\Models\ConnectedAccount;
use App\Models\User;
use Illuminate\Support\Facades\Context;

class ConnectedAccountPolicy
{
    public function viewAny(User $user): bool
    {
        return $user->hasAllPermissions(['workspace.read'], Context::get('workspace_id'));
    }

    public function create(User $user): bool
    {
        return $this->canManage($user);
    }

    public function update(User $user, ConnectedAccount $account): bool
    {
        return $this->ownsAccount($account) && $this->canManage($user);
    }

    public function delete(User $user, ConnectedAccount $account): bool
    {
        return $this->ownsAccount($account) && $this->canManage($user);
    }

    private function canManage(User $user): bool
    {
        return $user->hasAllPermissions(['workspace.accounts.manage'], Context::get('workspace_id'));
    }

    private function ownsAccount(ConnectedAccount $account): bool
    {
        return $account->workspace_id === Context::get('workspace_id');
    }
}
