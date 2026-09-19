<?php

use App\Enums\PostStatus;
use App\Enums\PostTargetStatus;
use App\Mcp\Servers\ShoutrrrServer;
use App\Mcp\Tools\CreatePostTool;
use App\Mcp\Tools\DeleteAccountSetTool;
use App\Mcp\Tools\DeletePostTool;
use App\Mcp\Tools\DeleteShareTool;
use App\Mcp\Tools\PublishPostTool;
use App\Mcp\Tools\RemovePostMediaTool;
use App\Mcp\Tools\RetryPostTargetTool;
use App\Mcp\Tools\SchedulePostTool;
use App\Mcp\Tools\UpdateAccountSetTool;
use App\Mcp\Tools\UpdatePostTool;
use App\Models\AccountSet;
use App\Models\Post;
use App\Models\PostMedia;
use App\Models\PostShare;
use App\Models\PostTarget;
use App\Models\User;
use App\Models\Workspace;
use Illuminate\Database\Eloquent\Model;

// ─── helpers ─────────────────────────────────────────────────────────────────

function setupUserInWorkspaceA(): array
{
    $user = User::factory()->create();
    $workspaceA = Workspace::factory()->create();
    $user->forceFill(['current_workspace_id' => $workspaceA->id])->save();
    bindTokenToWorkspace($user, $workspaceA);

    return [$user, $workspaceA];
}

/**
 * Reload a model row bypassing all global scopes.
 *
 * After a tool call, `bindWorkspace` leaves `workspace_id` in Context, so any
 * query on a HasWorkspaceScope model is automatically filtered to workspace A.
 * Foreign (workspace B) records are invisible through normal queries.  Use this
 * helper in all post-tool assertions that check whether the foreign record is
 * still intact.
 *
 * @template TModel of \Illuminate\Database\Eloquent\Model
 *
 * @param  TModel  $model
 * @return TModel|null
 */
function freshUnscoped(Model $model): ?Model
{
    return $model->newQueryWithoutScopes()->find($model->getKey());
}

// ─── update_post ─────────────────────────────────────────────────────────────

test('update_post rejects a post from another workspace', function (): void {
    [$user] = setupUserInWorkspaceA();
    $workspaceB = Workspace::factory()->create();

    $foreignPost = Post::factory()->for($workspaceB)->create(['base_text' => 'original']);

    $response = ShoutrrrServer::actingAs($user)->tool(UpdatePostTool::class, [
        'post_id' => $foreignPost->id,
        'base_text' => 'tampered',
        'destination' => ['kind' => 'all'],
    ]);

    $response->assertHasErrors();
    expect(freshUnscoped($foreignPost)?->base_text)->toBe('original');
});

// ─── delete_post ─────────────────────────────────────────────────────────────

test('delete_post rejects a post from another workspace', function (): void {
    [$user] = setupUserInWorkspaceA();
    $workspaceB = Workspace::factory()->create();

    $foreignPost = Post::factory()->for($workspaceB)->create(['status' => PostStatus::Draft->value]);

    $response = ShoutrrrServer::actingAs($user)->tool(DeletePostTool::class, [
        'post_id' => $foreignPost->id,
        'confirm' => true,
    ]);

    $response->assertHasErrors();
    expect(freshUnscoped($foreignPost))->not->toBeNull();
});

// ─── schedule_post ────────────────────────────────────────────────────────────

test('schedule_post rejects a post from another workspace', function (): void {
    [$user] = setupUserInWorkspaceA();
    $workspaceB = Workspace::factory()->create();

    $foreignPost = Post::factory()->for($workspaceB)->create(['status' => PostStatus::Draft->value]);
    $originalStatus = $foreignPost->status;

    $response = ShoutrrrServer::actingAs($user)->tool(SchedulePostTool::class, [
        'post_id' => $foreignPost->id,
        'scheduled_at' => now()->addDay()->toIso8601String(),
    ]);

    $response->assertHasErrors();
    expect(freshUnscoped($foreignPost)?->status)->toBe($originalStatus);
});

// ─── publish_post_now ─────────────────────────────────────────────────────────

test('publish_post_now rejects a post from another workspace', function (): void {
    [$user] = setupUserInWorkspaceA();
    $workspaceB = Workspace::factory()->create();

    $foreignPost = Post::factory()->for($workspaceB)->create(['status' => PostStatus::Draft->value]);

    $response = ShoutrrrServer::actingAs($user)->tool(PublishPostTool::class, [
        'post_id' => $foreignPost->id,
        'confirm' => true,
    ]);

    $response->assertHasErrors();
    expect(freshUnscoped($foreignPost)?->status)->not->toBe(PostStatus::Publishing);
});

// ─── retry_post_target ────────────────────────────────────────────────────────

test('retry_post_target rejects a target on a post from another workspace', function (): void {
    [$user] = setupUserInWorkspaceA();
    $workspaceB = Workspace::factory()->create();

    $foreignPost = Post::factory()->for($workspaceB)->create();
    $foreignTarget = PostTarget::factory()->for($foreignPost)->failed()->create();

    $response = ShoutrrrServer::actingAs($user)->tool(RetryPostTargetTool::class, [
        'post_id' => $foreignPost->id,
        'target_id' => $foreignTarget->id,
        'confirm' => true,
    ]);

    $response->assertHasErrors();
    // PostTarget has no workspace scope; fresh() is safe.
    expect($foreignTarget->fresh()->status)->toBe(PostTargetStatus::Failed);
});

// ─── remove_post_media ────────────────────────────────────────────────────────

test('remove_post_media rejects media from another workspace', function (): void {
    [$user] = setupUserInWorkspaceA();
    $workspaceB = Workspace::factory()->create();

    $foreignMedia = PostMedia::factory()->for($workspaceB)->create();

    $response = ShoutrrrServer::actingAs($user)->tool(RemovePostMediaTool::class, [
        'media_id' => $foreignMedia->id,
    ]);

    $response->assertHasErrors();
    expect(freshUnscoped($foreignMedia))->not->toBeNull();
});

// ─── delete_account_set ───────────────────────────────────────────────────────

test('delete_account_set rejects an account set from another workspace', function (): void {
    [$user] = setupUserInWorkspaceA();
    $workspaceB = Workspace::factory()->create();

    $foreignSet = AccountSet::factory()->for($workspaceB)->create();

    $response = ShoutrrrServer::actingAs($user)->tool(DeleteAccountSetTool::class, [
        'account_set_id' => $foreignSet->id,
    ]);

    $response->assertHasErrors();
    expect(freshUnscoped($foreignSet))->not->toBeNull();
});

// ─── update_account_set ───────────────────────────────────────────────────────

test('update_account_set rejects an account set from another workspace', function (): void {
    [$user] = setupUserInWorkspaceA();
    $workspaceB = Workspace::factory()->create();

    $foreignSet = AccountSet::factory()->for($workspaceB)->create(['name' => 'Original Name']);

    $response = ShoutrrrServer::actingAs($user)->tool(UpdateAccountSetTool::class, [
        'account_set_id' => $foreignSet->id,
        'name' => 'Tampered Name',
        'connected_account_ids' => [],
    ]);

    $response->assertHasErrors();
    expect(freshUnscoped($foreignSet)?->name)->toBe('Original Name');
});

// ─── delete_share ─────────────────────────────────────────────────────────────

test('delete_share rejects a share on a post from another workspace', function (): void {
    [$user] = setupUserInWorkspaceA();
    $workspaceB = Workspace::factory()->create();

    $foreignPost = Post::factory()->for($workspaceB)->create();
    $foreignShare = PostShare::factory()->for($foreignPost)->create();

    $response = ShoutrrrServer::actingAs($user)->tool(DeleteShareTool::class, [
        'post_id' => $foreignPost->id,
        'share_id' => $foreignShare->id,
    ]);

    $response->assertHasErrors();
    // PostShare has no workspace scope; fresh() is safe.
    expect($foreignShare->fresh()->revoked_at)->toBeNull();
});

// ─── create_post does not persist a foreign account_set_id ───────────────────

test('create_post ignores an account set from another workspace', function (): void {
    [$user, $workspaceA] = setupUserInWorkspaceA();
    $workspaceB = Workspace::factory()->create();
    $foreignSet = AccountSet::factory()->for($workspaceB)->create();

    $response = ShoutrrrServer::actingAs($user)->tool(CreatePostTool::class, [
        'base_text' => 'targets a foreign set',
        'destination' => ['kind' => 'set', 'id' => $foreignSet->id],
    ]);

    $response->assertOk();

    // The foreign set id must NOT be persisted (it would be a dangling cross-workspace
    // reference); the post belongs to workspace A with no targets.
    $post = Post::query()->where('base_text', 'targets a foreign set')->firstOrFail();
    expect($post->workspace_id)->toBe($workspaceA->id);
    expect($post->account_set_id)->toBeNull();
    expect($post->targets()->count())->toBe(0);
});
