<?php

use App\Models\McpGrantWorkspace;
use App\Models\User;
use App\Models\Workspace;
use Illuminate\Support\Facades\Date;

test('prune removes abandoned pending bindings and orphaned token bindings', function (): void {
    $user = User::factory()->create();
    $workspace = Workspace::factory()->create();

    $fresh = McpGrantWorkspace::create([
        'user_id' => $user->id, 'client_id' => 'c1',
        'workspace_id' => $workspace->id, 'access_token_id' => null,
    ]);

    $old = McpGrantWorkspace::create([
        'user_id' => $user->id, 'client_id' => 'c2',
        'workspace_id' => $workspace->id, 'access_token_id' => null,
    ]);
    $old->forceFill(['created_at' => Date::now()->subHours(2)])->save();

    $orphan = McpGrantWorkspace::create([
        'user_id' => $user->id, 'client_id' => 'c3',
        'workspace_id' => $workspace->id, 'access_token_id' => 'no-such-token',
    ]);

    $this->artisan('mcp:prune-bindings')->assertSuccessful();

    expect(McpGrantWorkspace::find($fresh->id))->not->toBeNull();
    expect(McpGrantWorkspace::find($old->id))->toBeNull();
    expect(McpGrantWorkspace::find($orphan->id))->toBeNull();
});
