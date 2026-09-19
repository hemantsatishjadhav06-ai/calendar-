<?php

use App\Enums\PostStatus;
use App\Mcp\Servers\ShoutrrrServer;
use App\Mcp\Tools\SchedulePostTool;
use App\Models\Post;
use App\Models\User;
use App\Models\Workspace;

test('schedule_post sets a future scheduled time', function (): void {
    $user = User::factory()->create();
    $workspace = Workspace::factory()->create();
    $user->forceFill(['current_workspace_id' => $workspace->id])->save();
    bindTokenToWorkspace($user, $workspace);

    $post = Post::factory()->for($workspace)->create(['status' => PostStatus::Draft->value]);
    $when = now()->addDay()->toIso8601String();

    $response = ShoutrrrServer::actingAs($user)->tool(SchedulePostTool::class, [
        'post_id' => $post->id, 'scheduled_at' => $when,
    ]);

    $response->assertOk();
    expect($post->fresh()->status)->toBe(PostStatus::Scheduled);
});

test('schedule_post rejects a past time', function (): void {
    $user = User::factory()->create();
    $workspace = Workspace::factory()->create();
    $user->forceFill(['current_workspace_id' => $workspace->id])->save();
    bindTokenToWorkspace($user, $workspace);
    $post = Post::factory()->for($workspace)->create();

    $response = ShoutrrrServer::actingAs($user)->tool(SchedulePostTool::class, [
        'post_id' => $post->id, 'scheduled_at' => now()->subDay()->toIso8601String(),
    ]);
    $response->assertHasErrors();
});
