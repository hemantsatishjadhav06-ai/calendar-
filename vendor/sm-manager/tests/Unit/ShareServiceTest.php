<?php

declare(strict_types=1);

use App\Models\Post;
use App\Models\PostShare;
use App\Models\User;
use App\Models\Workspace;
use App\Services\Posts\ShareService;

it('mints a share with a hashed token and resolves it back', function (): void {
    $workspace = Workspace::factory()->create();
    $user = User::factory()->create();
    $post = Post::factory()->for($workspace)->create(['author_id' => $user->id]);

    $service = app(ShareService::class);
    [$share, $token] = $service->mint($post, $user, null);

    expect($token)->toBeString()->not->toBe('')
        ->and($share->token_hash)->toBe(hash('sha256', $token))
        ->and(PostShare::query()->where('token_hash', $share->token_hash)->exists())->toBeTrue();

    expect($service->resolveActive($token)?->is($share))->toBeTrue();
});

it('does not resolve revoked or expired tokens', function (): void {
    $service = app(ShareService::class);
    $token = 'plain-token';
    $hash = hash('sha256', $token);

    PostShare::factory()->revoked()->create(['token_hash' => $hash]);
    expect($service->resolveActive($token))->toBeNull();

    PostShare::query()->delete();
    PostShare::factory()->expired()->create(['token_hash' => $hash]);
    expect($service->resolveActive($token))->toBeNull();
});
