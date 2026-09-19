<?php

declare(strict_types=1);

use App\Enums\PostStatus;
use App\Enums\WorkspaceRole;
use App\Models\Post;
use App\Models\User;
use App\Models\Workspace;
use App\Models\WorkspaceMembership;
use Illuminate\Support\Facades\Context;

beforeEach(function (): void {
    $this->user = User::factory()->create();
    $this->workspace = Workspace::factory()->create(['owner_id' => $this->user->id]);
    WorkspaceMembership::factory()->create([
        'workspace_id' => $this->workspace->id,
        'user_id' => $this->user->id,
        'role' => WorkspaceRole::Member,
    ]);
    $this->user->forceFill(['current_workspace_id' => $this->workspace->id])->save();
    Context::add('workspace_id', $this->workspace->id);
});

it('requires authentication', function (): void {
    $this->getJson(route('command-search', ['q' => 'hello']))
        ->assertUnauthorized();
});

it('matches posts by base_text within the current workspace', function (): void {
    Post::factory()->for($this->workspace)->create([
        'author_id' => $this->user->id,
        'base_text' => 'Launch announcement draft',
    ]);
    Post::factory()->for($this->workspace)->create([
        'author_id' => $this->user->id,
        'base_text' => 'Unrelated text',
    ]);

    $this->actingAs($this->user)
        ->getJson(route('command-search', ['q' => 'launch']))
        ->assertOk()
        ->assertJsonCount(1, 'posts')
        ->assertJsonPath('posts.0.excerpt', 'Launch announcement draft');
});

it('excludes deleted posts', function (): void {
    Post::factory()->for($this->workspace)->create([
        'author_id' => $this->user->id,
        'base_text' => 'Deleted launch',
        'status' => PostStatus::Deleted->value,
    ]);

    $this->actingAs($this->user)
        ->getJson(route('command-search', ['q' => 'launch']))
        ->assertOk()
        ->assertJsonCount(0, 'posts');
});

it('never returns another workspace posts', function (): void {
    $other = Workspace::factory()->create();
    Post::factory()->for($other)->create([
        'author_id' => $this->user->id,
        'base_text' => 'Secret launch from another workspace',
    ]);

    $this->actingAs($this->user)
        ->getJson(route('command-search', ['q' => 'launch']))
        ->assertOk()
        ->assertJsonCount(0, 'posts');
});

it('returns nothing for queries shorter than two characters', function (): void {
    Post::factory()->for($this->workspace)->create([
        'author_id' => $this->user->id,
        'base_text' => 'a quick brown fox',
    ]);

    $this->actingAs($this->user)
        ->getJson(route('command-search', ['q' => 'a']))
        ->assertOk()
        ->assertExactJson(['posts' => []]);
});

it('caps results at eight posts', function (): void {
    Post::factory()->count(12)->for($this->workspace)->create([
        'author_id' => $this->user->id,
        'base_text' => 'launch number',
    ]);

    $this->actingAs($this->user)
        ->getJson(route('command-search', ['q' => 'launch']))
        ->assertOk()
        ->assertJsonCount(8, 'posts');
});
