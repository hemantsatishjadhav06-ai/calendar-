<?php

use App\Models\ConnectedAccount;
use App\Models\Post;
use App\Models\User;
use App\Models\Workspace;

test('new workspaces start with null onboarding timestamps', function () {
    $workspace = Workspace::factory()->create();

    expect($workspace->onboarding_welcomed_at)->toBeNull()
        ->and($workspace->onboarding_dismissed_at)->toBeNull();
});

test('workspace exposes posts and connectedAccounts relations', function () {
    $workspace = Workspace::factory()->create();
    $user = User::factory()->create();
    Post::factory()->create(['workspace_id' => $workspace->id, 'author_id' => $user->id]);
    ConnectedAccount::factory()->create(['workspace_id' => $workspace->id]);

    expect($workspace->posts()->count())->toBe(1)
        ->and($workspace->connectedAccounts()->count())->toBe(1);
});
