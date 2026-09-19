<?php

use App\Enums\NotificationType;
use App\Models\User;

test('preferences screen renders with current values', function () {
    $user = User::factory()->create();

    $this->actingAs($user)
        ->get(route('notifications.preferences'))
        ->assertOk()
        ->assertInertia(fn ($page) => $page
            ->component('settings/notifications')
            ->has('preferences')
        );
});

test('updating preferences persists the matrix', function () {
    $user = User::factory()->create();

    $this->actingAs($user)
        ->put(route('notifications.preferences.update'), [
            'preferences' => [
                'post_published' => ['in_app' => false, 'mail' => false],
                'publish_failed' => ['in_app' => false, 'mail' => true],
                'workspace_invite' => ['in_app' => true, 'mail' => true],
                'account_needs_attention' => ['in_app' => true, 'mail' => false],
            ],
        ])
        ->assertRedirect();

    $prefs = $user->fresh()->notificationPreferences();
    expect($prefs->allows(NotificationType::PostPublished, 'in_app'))->toBeFalse();
    // always-on clamp still applies on read
    expect($prefs->allows(NotificationType::PublishFailed, 'in_app'))->toBeTrue();
    expect($prefs->allows(NotificationType::AccountNeedsAttention, 'mail'))->toBeFalse();
});
