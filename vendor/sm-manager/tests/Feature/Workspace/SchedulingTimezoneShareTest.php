<?php

declare(strict_types=1);

use App\Enums\WorkspaceRole;
use App\Models\PostingSchedule;
use App\Models\User;
use App\Models\Workspace;
use App\Models\WorkspaceMembership;
use Illuminate\Support\Facades\Context;
use Inertia\Testing\AssertableInertia;

/**
 * Create a workspace member whose current workspace + request Context are set.
 *
 * @return array{0: User, 1: Workspace}
 */
function schedulingTimezoneTestMember(): array
{
    $user = User::factory()->create();
    $workspace = Workspace::factory()->create(['owner_id' => $user->id]);
    WorkspaceMembership::factory()->create([
        'workspace_id' => $workspace->id,
        'user_id' => $user->id,
        'role' => WorkspaceRole::Member,
    ]);
    $user->forceFill(['current_workspace_id' => $workspace->id])->save();
    Context::add('workspace_id', $workspace->id);

    return [$user, $workspace];
}

test('exposes the posting schedule timezone as workspaces.current.timezone', function (): void {
    [$user, $workspace] = schedulingTimezoneTestMember();
    PostingSchedule::factory()->create([
        'workspace_id' => $workspace->id,
        'timezone' => 'Asia/Kolkata',
    ]);

    $this->actingAs($user)
        ->get(route('dashboard'))
        ->assertInertia(fn (AssertableInertia $page) => $page
            ->where('workspaces.current.timezone', 'Asia/Kolkata')
        );
});

test('defaults timezone to UTC when no posting schedule exists', function (): void {
    [$user] = schedulingTimezoneTestMember();

    $this->actingAs($user)
        ->get(route('dashboard'))
        ->assertInertia(fn (AssertableInertia $page) => $page
            ->where('workspaces.current.timezone', 'UTC')
        );
});
