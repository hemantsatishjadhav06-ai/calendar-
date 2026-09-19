<?php

use App\Enums\WorkspaceRole;
use App\Models\User;
use App\Models\Workspace;
use App\Models\WorkspaceMembership;
use Illuminate\Support\Facades\Context;
use Illuminate\Support\Facades\Gate;

test('gate grants workspace abilities from current context', function () {
    $workspace = Workspace::factory()->create();
    $user = User::factory()->create();
    WorkspaceMembership::factory()->create([
        'workspace_id' => $workspace->id,
        'user_id' => $user->id,
        'role' => WorkspaceRole::Admin,
    ]);

    Context::add('workspace_id', $workspace->id);

    $this->assertTrue(Gate::forUser($user)->allows('workspace.users.manage'));
    $this->assertFalse(Gate::forUser($user)->allows('workspace.delete'));
});
