<?php

use App\Enums\WorkspaceRole;
use App\Models\ConnectedAccount;
use App\Models\User;
use App\Models\Workspace;
use App\Models\WorkspaceMembership;
use Illuminate\Support\Facades\Context;

function memberWithRole(WorkspaceRole $role): array
{
    $user = User::factory()->create();
    $workspace = Workspace::factory()->create(['owner_id' => $user->id]);
    WorkspaceMembership::factory()->create([
        'workspace_id' => $workspace->id,
        'user_id' => $user->id,
        'role' => $role,
    ]);
    $user->forceFill(['current_workspace_id' => $workspace->id])->save();
    Context::add('workspace_id', $workspace->id);

    return [$user, $workspace];
}

test('owners and admins may manage connected accounts; members may only view', function () {
    [$owner] = memberWithRole(WorkspaceRole::Owner);
    expect($owner->can('create', ConnectedAccount::class))->toBeTrue()
        ->and($owner->can('viewAny', ConnectedAccount::class))->toBeTrue();

    Context::forget('workspace_id');
    [$admin] = memberWithRole(WorkspaceRole::Admin);
    expect($admin->can('create', ConnectedAccount::class))->toBeTrue();

    Context::forget('workspace_id');
    [$member] = memberWithRole(WorkspaceRole::Member);
    expect($member->can('create', ConnectedAccount::class))->toBeFalse()
        ->and($member->can('viewAny', ConnectedAccount::class))->toBeTrue();
});
