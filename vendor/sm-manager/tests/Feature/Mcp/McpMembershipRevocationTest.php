<?php

use App\Enums\WorkspaceRole;
use App\Mcp\Servers\ShoutrrrServer;
use App\Mcp\Tools\CreatePostTool;
use App\Models\McpGrantWorkspace;
use App\Models\User;
use App\Models\Workspace;
use App\Models\WorkspaceMembership;

test('a write tool is denied once the user is removed from the bound workspace', function () {
    $user = User::factory()->create();
    $workspace = Workspace::factory()->create();
    $user->forceFill(['current_workspace_id' => $workspace->id])->save();
    bindTokenToWorkspace($user, $workspace);

    // Sanity: while a member, the tool works.
    ShoutrrrServer::actingAs($user)->tool(CreatePostTool::class, [
        'base_text' => 'hi',
        'destination' => ['kind' => 'all'],
    ])->assertOk();

    // Remove the membership (simulating removeMember / leave).
    WorkspaceMembership::query()
        ->where('workspace_id', $workspace->id)
        ->where('user_id', $user->id)
        ->first()
        ->delete();

    ShoutrrrServer::actingAs($user->fresh())->tool(CreatePostTool::class, [
        'base_text' => 'hi again',
        'destination' => ['kind' => 'all'],
    ])->assertHasErrors();
});

test('deleting a membership purges that user\'s MCP grants for the workspace', function () {
    $user = User::factory()->create();
    $workspace = Workspace::factory()->create();
    bindTokenToWorkspace($user, $workspace);

    expect(McpGrantWorkspace::query()->where('workspace_id', $workspace->id)->where('user_id', $user->id)->exists())
        ->toBeTrue();

    WorkspaceMembership::query()
        ->where('workspace_id', $workspace->id)
        ->where('user_id', $user->id)
        ->first()
        ->delete();

    expect(McpGrantWorkspace::query()->where('workspace_id', $workspace->id)->where('user_id', $user->id)->exists())
        ->toBeFalse();
});

test('a member with workspace.read may still use write tools (authz parity not over-restricted)', function () {
    $user = User::factory()->create();
    $workspace = Workspace::factory()->create();
    $user->forceFill(['current_workspace_id' => $workspace->id])->save();
    // bindTokenToWorkspace gives the user the Member role (workspace.read only).
    bindTokenToWorkspace($user, $workspace);

    expect(WorkspaceMembership::query()->where('user_id', $user->id)->value('role'))
        ->toBe(WorkspaceRole::Member);

    ShoutrrrServer::actingAs($user)->tool(CreatePostTool::class, [
        'base_text' => 'member post',
        'destination' => ['kind' => 'all'],
    ])->assertOk();
});
