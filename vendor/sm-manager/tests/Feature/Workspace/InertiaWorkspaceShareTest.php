<?php

use App\Models\User;
use App\Models\Workspace;
use App\Models\WorkspaceMembership;
use Inertia\Testing\AssertableInertia;

beforeEach(function () {
    config(['kit.workspaces.enabled' => true]);
});

test('dashboard shares current workspace and list', function () {
    $workspace = Workspace::factory()->create(['name' => 'Acme']);
    $user = User::factory()->create(['current_workspace_id' => $workspace->id]);
    WorkspaceMembership::factory()->owner()->create(['workspace_id' => $workspace->id, 'user_id' => $user->id]);

    $this->actingAs($user)->get(route('dashboard'))
        ->assertInertia(fn (AssertableInertia $page) => $page
            ->where('workspaces.current.name', 'Acme')
            ->where('workspaces.current.role', 'owner')
            ->has('workspaces.all', 1)
            ->where('workspaces.enabled', true)
        );
});

test('dashboard does not allow workspace creation when workspaces are globally disabled', function () {
    config(['kit.workspaces.enabled' => false]);

    $user = User::factory()->create();

    $this->actingAs($user)->get(route('dashboard'))
        ->assertInertia(fn (AssertableInertia $page) => $page
            ->where('workspaces.enabled', false)
            ->where('workspaces.canCreateWorkspaces', false)
        );
});
