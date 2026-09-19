<?php

use App\Mcp\Servers\ShoutrrrServer;
use App\Mcp\Tools\CreateShareLinkTool;
use App\Mcp\Tools\DeleteShareTool;
use App\Mcp\Tools\ListSharesTool;
use App\Models\Post;
use App\Models\PostShare;
use App\Models\User;
use App\Models\Workspace;

test('share link lifecycle', function (): void {
    $user = User::factory()->create();
    $workspace = Workspace::factory()->create();
    $user->forceFill(['current_workspace_id' => $workspace->id])->save();
    bindTokenToWorkspace($user, $workspace);
    $post = Post::factory()->for($workspace)->create();

    $created = ShoutrrrServer::actingAs($user)->tool(CreateShareLinkTool::class, ['post_id' => $post->id]);
    $created->assertOk()->assertSee('/share/');

    $list = ShoutrrrServer::actingAs($user)->tool(ListSharesTool::class, ['post_id' => $post->id]);
    $list->assertOk();
    $share = PostShare::query()->where('post_id', $post->id)->firstOrFail();

    $deleted = ShoutrrrServer::actingAs($user)->tool(DeleteShareTool::class, [
        'post_id' => $post->id, 'share_id' => $share->id,
    ]);
    $deleted->assertOk();
    expect($share->fresh()->revoked_at)->not->toBeNull();
});
