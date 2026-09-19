<?php

use App\Enums\Platform;
use App\Jobs\CaptureAccountMetrics;
use App\Jobs\CapturePostTargetMetrics;
use App\Models\ConnectedAccount;
use App\Models\PostTarget;
use Illuminate\Contracts\Queue\ShouldBeUnique;
use Illuminate\Queue\Middleware\RateLimited;
use Illuminate\Support\Facades\RateLimiter;

test('the account capture job is unique per account, retried, and platform rate limited', function () {
    $account = ConnectedAccount::factory()->create(['platform' => Platform::X]);
    $job = new CaptureAccountMetrics($account);

    expect($job)->toBeInstanceOf(ShouldBeUnique::class)
        ->and($job->uniqueId())->toBe($account->id)
        ->and($job->tries)->toBe(3)
        ->and($job->backoff())->toBe([10, 30, 60]);

    $middleware = $job->middleware();
    expect($middleware)->toHaveCount(1)
        ->and($middleware[0])->toBeInstanceOf(RateLimited::class);
});

test('the post-target capture job is unique per target, retried, and platform rate limited', function () {
    $account = ConnectedAccount::factory()->create(['platform' => Platform::Bluesky]);
    $target = PostTarget::factory()->create([
        'connected_account_id' => $account->id,
        'platform' => Platform::Bluesky,
    ]);
    $job = new CapturePostTargetMetrics($target);

    expect($job)->toBeInstanceOf(ShouldBeUnique::class)
        ->and($job->uniqueId())->toBe($target->id)
        ->and($job->tries)->toBe(3)
        ->and($job->backoff())->toBe([10, 30, 60]);

    $middleware = $job->middleware();
    expect($middleware)->toHaveCount(1)
        ->and($middleware[0])->toBeInstanceOf(RateLimited::class);
});

test('a metrics rate limiter is registered for every platform', function () {
    foreach (Platform::cases() as $platform) {
        expect(RateLimiter::limiter("metrics-{$platform->value}"))->not->toBeNull();
    }
});
