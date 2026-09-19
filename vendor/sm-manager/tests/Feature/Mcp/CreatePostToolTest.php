<?php

use App\Mcp\Servers\ShoutrrrServer;
use App\Mcp\Tools\CreatePostTool;
use App\Models\Post;
use App\Models\User;
use App\Models\Workspace;

test('create_post creates a draft in the bound workspace', function (): void {
    $user = User::factory()->create();
    $workspace = Workspace::factory()->create();
    $user->forceFill(['current_workspace_id' => $workspace->id])->save();
    bindTokenToWorkspace($user, $workspace);

    $response = ShoutrrrServer::actingAs($user)->tool(CreatePostTool::class, [
        'base_text' => 'my first draft',
        'destination' => ['kind' => 'all'],
    ]);

    $response->assertOk()->assertSee('my first draft');
    expect(Post::query()->where('workspace_id', $workspace->id)->where('base_text', 'my first draft')->exists())->toBeTrue();
});
