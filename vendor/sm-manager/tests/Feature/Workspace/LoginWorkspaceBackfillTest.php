<?php

use App\Listeners\SetCurrentWorkspaceOnLogin;
use App\Models\User;
use App\Models\Workspace;
use App\Models\WorkspaceMembership;
use Illuminate\Auth\Events\Login;

test('login sets current workspace when missing', function () {
    $workspace = Workspace::factory()->create();
    $user = User::factory()->create(['current_workspace_id' => null]);
    WorkspaceMembership::factory()->create(['workspace_id' => $workspace->id, 'user_id' => $user->id]);

    (new SetCurrentWorkspaceOnLogin)->handle(new Login('web', $user, false));

    $this->assertSame($workspace->id, $user->fresh()->current_workspace_id);
});
