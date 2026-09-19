<?php

use App\Mcp\Servers\ShoutrrrServer;
use App\Mcp\Tools\QueuePostTool;
use App\Models\Post;
use App\Models\User;
use App\Models\Workspace;

test('queue_post returns a clear message when no slot is configured', function (): void {
    $user = User::factory()->create();
    $workspace = Workspace::factory()->create();
    $user->forceFill(['current_workspace_id' => $workspace->id])->save();
    bindTokenToWorkspace($user, $workspace);
    $post = Post::factory()->for($workspace)->create();

    $response = ShoutrrrServer::actingAs($user)->tool(QueuePostTool::class, ['post_id' => $post->id]);

    // No posting-schedule slots → resolver returns null → tool errors with guidance.
    $response->assertHasErrors();
});
