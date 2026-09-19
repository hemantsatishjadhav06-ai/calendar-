<?php

use App\Models\User;
use App\Models\Workspace;
use App\Models\WorkspaceInvitation;
use App\Notifications\WorkspaceInviteAcceptedNotification;
use App\Services\Workspace\WorkspaceInvitationService;
use Illuminate\Support\Facades\Notification;

test('accepting an invitation notifies the inviter', function () {
    Notification::fake();

    $inviter = User::factory()->create();
    $workspace = Workspace::factory()->create();
    // attach inviter as owner
    $workspace->members()->create(['user_id' => $inviter->id, 'role' => 'owner']);

    [$plain, $hash] = WorkspaceInvitation::generateToken();
    $invitation = WorkspaceInvitation::create([
        'workspace_id' => $workspace->id,
        'invited_by' => $inviter->id,
        'email' => 'newbie@example.com',
        'role' => 'member',
        'token' => $hash,
        'expires_at' => now()->addDays(7),
    ]);

    $accepter = User::factory()->create(['email' => 'newbie@example.com']);

    app(WorkspaceInvitationService::class)->accept($invitation, $accepter);

    Notification::assertSentTo($inviter, WorkspaceInviteAcceptedNotification::class);
});
