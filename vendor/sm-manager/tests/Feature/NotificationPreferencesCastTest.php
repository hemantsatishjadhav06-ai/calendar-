<?php

use App\Enums\NotificationType;
use App\Models\User;
use App\Support\Notifications\NotificationPreferences;

test('notification preferences persist and round-trip through the cast', function () {
    $user = User::factory()->create();

    $user->update([
        'notification_preferences' => NotificationPreferences::fromArray([
            'post_published' => ['in_app' => false, 'mail' => false],
        ]),
    ]);

    $fresh = $user->fresh();

    expect($fresh->notificationPreferences()->allows(NotificationType::PostPublished, 'in_app'))->toBeFalse();
    expect($fresh->notificationPreferences()->allows(NotificationType::WorkspaceInvite, 'in_app'))->toBeTrue();
});

test('user with no stored preferences returns defaults', function () {
    $user = User::factory()->create();

    expect($user->notificationPreferences()->allows(NotificationType::PostPublished, 'in_app'))->toBeTrue();
    expect($user->notificationPreferences()->allows(NotificationType::PostPublished, 'mail'))->toBeFalse();
    expect($user->notificationPreferences()->allows(NotificationType::PublishFailed, 'mail'))->toBeTrue();
    expect($user->notificationPreferences()->allows(NotificationType::AccountNeedsAttention, 'mail'))->toBeTrue();
});
