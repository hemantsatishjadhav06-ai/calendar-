<?php

use App\Enums\WorkspaceRole;
use App\Models\User;
use App\Models\Workspace;
use App\Models\WorkspaceMembership;
use Illuminate\Database\QueryException;

test('role is cast to enum and exposes permissions', function () {
    $membership = WorkspaceMembership::factory()->create(['role' => WorkspaceRole::Owner]);

    $this->assertSame(WorkspaceRole::Owner, $membership->role);
    $this->assertContains('workspace.delete', $membership->permissions);
});

test('duplicate membership is rejected', function () {
    $workspace = Workspace::factory()->create();
    $user = User::factory()->create();

    WorkspaceMembership::factory()->create(['workspace_id' => $workspace->id, 'user_id' => $user->id]);

    $this->expectException(QueryException::class);
    WorkspaceMembership::factory()->create(['workspace_id' => $workspace->id, 'user_id' => $user->id]);
});
