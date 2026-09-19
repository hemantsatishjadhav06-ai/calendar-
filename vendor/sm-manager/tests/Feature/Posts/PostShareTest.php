<?php

declare(strict_types=1);

use App\Enums\WorkspaceRole;
use App\Models\Post;
use App\Models\PostShare;
use App\Models\User;
use App\Models\Workspace;
use App\Models\WorkspaceMembership;
use Illuminate\Support\Facades\Context;

beforeEach(function (): void {
    $this->user = User::factory()->create();
    $this->workspace = Workspace::factory()->create(['owner_id' => $this->user->id]);
    WorkspaceMembership::factory()->create([
        'workspace_id' => $this->workspace->id, 'user_id' => $this->user->id, 'role' => WorkspaceRole::Member,
    ]);
    $this->user->forceFill(['current_workspace_id' => $this->workspace->id])->save();
    Context::add('workspace_id', $this->workspace->id);
    $this->post = Post::factory()->for($this->workspace)->create(['author_id' => $this->user->id]);
});

it('mints a share and returns the plaintext url once', function (): void {
    $this->actingAs($this->user)
        ->postJson(route('posts.shares.store', $this->post), ['expires_at' => null])
        ->assertOk()
        ->assertJsonStructure(['id', 'url', 'expires_at']);

    expect(PostShare::query()->where('post_id', $this->post->id)->count())->toBe(1);
});

it('lists only active shares', function (): void {
    PostShare::factory()->for($this->post)->create();
    PostShare::factory()->for($this->post)->revoked()->create();
    PostShare::factory()->for($this->post)->expired()->create();

    $this->actingAs($this->user)
        ->getJson(route('posts.shares.index', $this->post))
        ->assertOk()
        ->assertJsonCount(1);
});

it('revokes a share', function (): void {
    $share = PostShare::factory()->for($this->post)->create();

    $this->actingAs($this->user)
        ->deleteJson(route('posts.shares.destroy', ['post' => $this->post, 'share' => $share->id]))
        ->assertNoContent();

    expect($share->fresh()->revoked_at)->not->toBeNull();
});
