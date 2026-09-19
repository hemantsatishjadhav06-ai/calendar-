<?php

use App\Models\User;
use App\Models\Workspace;
use App\Models\WorkspaceMembership;
use Illuminate\Support\Facades\Context;
use Illuminate\Support\Facades\Route;

test('middleware sets current workspace in context', function () {
    Route::middleware('web')->get('/__ctx', fn () => Context::get('workspace_id'));

    $workspace = Workspace::factory()->create();
    $user = User::factory()->create(['current_workspace_id' => $workspace->id]);
    WorkspaceMembership::factory()->create(['workspace_id' => $workspace->id, 'user_id' => $user->id]);

    $this->actingAs($user)->get('/__ctx')->assertSee($workspace->id);
});
