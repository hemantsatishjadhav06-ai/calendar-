<?php

use App\Models\User;
use App\Models\Workspace;
use App\Models\WorkspaceMembership;

test('sole owner with other members cannot delete account', function () {
    $workspace = Workspace::factory()->create();
    $owner = User::factory()->create(['current_workspace_id' => $workspace->id]);
    $member = User::factory()->create();
    WorkspaceMembership::factory()->owner()->create(['workspace_id' => $workspace->id, 'user_id' => $owner->id]);
    WorkspaceMembership::factory()->create(['workspace_id' => $workspace->id, 'user_id' => $member->id]);

    $this->actingAs($owner)->delete(route('profile.destroy'), ['password' => 'password'])
        ->assertSessionHasErrors();

    $this->assertDatabaseHas('users', ['id' => $owner->id]);
});

test('sole owner of a single member workspace can delete account', function () {
    $workspace = Workspace::factory()->create();
    $owner = User::factory()->create(['current_workspace_id' => $workspace->id]);
    $workspace->update(['owner_id' => $owner->id]);
    WorkspaceMembership::factory()->owner()->create(['workspace_id' => $workspace->id, 'user_id' => $owner->id]);

    $this->actingAs($owner)->delete(route('profile.destroy'), ['password' => 'password'])
        ->assertRedirect('/');

    $this->assertDatabaseMissing('users', ['id' => $owner->id]);
    $this->assertDatabaseMissing('workspaces', ['id' => $workspace->id]);
});
