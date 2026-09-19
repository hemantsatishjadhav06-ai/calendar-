<?php

use App\Models\AccountSet;
use App\Models\ConnectedAccount;
use App\Models\User;
use App\Models\Workspace;
use App\Models\WorkspaceMembership;
use Inertia\Testing\AssertableInertia;

test('shell only exposes connected accounts from the current workspace', function () {
    $current = Workspace::factory()->create();
    $other = Workspace::factory()->create();

    $user = User::factory()->create([
        'current_workspace_id' => $current->id,
        'email_verified_at' => now(),
    ]);
    WorkspaceMembership::factory()->owner()->create([
        'workspace_id' => $current->id,
        'user_id' => $user->id,
    ]);

    $mine = ConnectedAccount::factory()->create(['workspace_id' => $current->id]);
    // An account in a different workspace must never appear in the shell.
    ConnectedAccount::factory()->create(['workspace_id' => $other->id]);

    $this->actingAs($user)->get(route('dashboard'))
        ->assertOk()
        ->assertInertia(fn (AssertableInertia $page): AssertableInertia => $page
            ->has('shell.accounts', 1)
            ->where('shell.accounts.0.id', $mine->id)
        );
});

test('shell only exposes account sets from the current workspace', function () {
    $current = Workspace::factory()->create();
    $other = Workspace::factory()->create();

    $user = User::factory()->create([
        'current_workspace_id' => $current->id,
        'email_verified_at' => now(),
    ]);
    WorkspaceMembership::factory()->owner()->create([
        'workspace_id' => $current->id,
        'user_id' => $user->id,
    ]);

    $mine = AccountSet::factory()->create(['workspace_id' => $current->id]);
    AccountSet::factory()->create(['workspace_id' => $other->id]);

    $this->actingAs($user)->get(route('dashboard'))
        ->assertOk()
        ->assertInertia(fn (AssertableInertia $page): AssertableInertia => $page
            ->has('shell.sets', 1)
            ->where('shell.sets.0.id', $mine->id)
        );
});

test('shell lists the workspace default connected account first', function () {
    $workspace = Workspace::factory()->create();
    $user = User::factory()->create([
        'current_workspace_id' => $workspace->id,
        'email_verified_at' => now(),
    ]);
    WorkspaceMembership::factory()->owner()->create([
        'workspace_id' => $workspace->id,
        'user_id' => $user->id,
    ]);

    ConnectedAccount::factory()->create(['workspace_id' => $workspace->id]);
    $default = ConnectedAccount::factory()->create(['workspace_id' => $workspace->id]);
    $workspace->forceFill(['default_connected_account_id' => $default->id])->save();

    $this->actingAs($user)->get(route('dashboard'))
        ->assertOk()
        ->assertInertia(fn (AssertableInertia $page): AssertableInertia => $page
            ->where('shell.accounts.0.id', $default->id)
        );
});
