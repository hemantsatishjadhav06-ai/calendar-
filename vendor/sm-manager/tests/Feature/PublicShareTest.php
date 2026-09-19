<?php

declare(strict_types=1);

use App\Models\Post;
use App\Models\PostShare;
use App\Models\User;
use App\Models\Workspace;

function shareFor(string $token, ?callable $state = null): PostShare
{
    $workspace = Workspace::factory()->create();
    $user = User::factory()->create();
    $post = Post::factory()->for($workspace)->create([
        'author_id' => $user->id, 'base_text' => 'shared body',
    ]);
    $factory = PostShare::factory()->for($post)->state(['token_hash' => hash('sha256', $token)]);
    if ($state !== null) {
        $factory = $state($factory);
    }

    return $factory->create();
}

it('renders a read-only view for a valid token', function (): void {
    shareFor('good-token');

    $this->get('/share/good-token')
        ->assertOk()
        ->assertHeader('X-Robots-Tag', 'noindex, nofollow')
        ->assertInertia(fn ($page) => $page
            ->component('share/show')
            ->where('post.base_text', 'shared body'));
});

it('shows not-available for unknown / revoked / expired tokens', function (): void {
    $this->get('/share/nope')->assertInertia(fn ($page) => $page
        ->component('share/show')->where('post', null));

    shareFor('revoked-token', fn ($f) => $f->revoked());
    $this->get('/share/revoked-token')->assertInertia(fn ($page) => $page->where('post', null));

    shareFor('expired-token', fn ($f) => $f->expired());
    $this->get('/share/expired-token')->assertInertia(fn ($page) => $page->where('post', null));
});
