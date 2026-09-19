<?php

use App\Enums\PostStatus;
use App\Enums\PostTargetStatus;
use App\Jobs\DeletePostTarget;
use App\Mcp\Servers\ShoutrrrServer;
use App\Mcp\Tools\DeletePostTool;
use App\Models\Post;
use App\Models\PostTarget;
use App\Models\User;
use App\Models\Workspace;
use Illuminate\Support\Facades\Queue;

test('delete_post requires confirmation', function (): void {
    $user = User::factory()->create();
    $workspace = Workspace::factory()->create();
    $user->forceFill(['current_workspace_id' => $workspace->id])->save();
    bindTokenToWorkspace($user, $workspace);
    $post = Post::factory()->for($workspace)->create(['status' => PostStatus::Draft->value]);

    $response = ShoutrrrServer::actingAs($user)->tool(DeletePostTool::class, ['post_id' => $post->id]);

    $response->assertHasErrors();
    expect(Post::find($post->id))->not->toBeNull();
});

test('delete_post with confirm hard-deletes a draft', function (): void {
    $user = User::factory()->create();
    $workspace = Workspace::factory()->create();
    $user->forceFill(['current_workspace_id' => $workspace->id])->save();
    bindTokenToWorkspace($user, $workspace);
    $post = Post::factory()->for($workspace)->create(['status' => PostStatus::Draft->value]);

    $response = ShoutrrrServer::actingAs($user)->tool(DeletePostTool::class, [
        'post_id' => $post->id,
        'confirm' => true,
    ]);

    $response->assertOk();
    expect(Post::find($post->id))->toBeNull();
});

test('delete_post with confirm soft-deletes a published post and dispatches remote delete for targets with remote_id', function (): void {
    Queue::fake();
    $user = User::factory()->create();
    $workspace = Workspace::factory()->create();
    $user->forceFill(['current_workspace_id' => $workspace->id])->save();
    bindTokenToWorkspace($user, $workspace);

    $post = Post::factory()->for($workspace)->create(['status' => PostStatus::Published->value]);
    $targetWithRemote = PostTarget::factory()->for($post)->create([
        'status' => PostTargetStatus::Published->value,
        'remote_id' => 'remote-abc',
    ]);
    PostTarget::factory()->for($post)->create([
        'status' => PostTargetStatus::Published->value,
        'remote_id' => null,
    ]);

    $response = ShoutrrrServer::actingAs($user)->tool(DeletePostTool::class, [
        'post_id' => $post->id,
        'confirm' => true,
    ]);

    $response->assertOk();
    expect($post->fresh()->status)->toBe(PostStatus::Deleted)
        ->and($post->fresh()->deleted_at)->not->toBeNull();
    Queue::assertPushed(DeletePostTarget::class, 1);
    Queue::assertPushed(
        DeletePostTarget::class,
        fn (DeletePostTarget $job): bool => $job->target->is($targetWithRemote)
    );
});
