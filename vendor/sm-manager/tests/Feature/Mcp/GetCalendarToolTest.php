<?php

use App\Enums\PostStatus;
use App\Mcp\Servers\ShoutrrrServer;
use App\Mcp\Tools\GetCalendarTool;
use App\Models\Post;
use App\Models\User;
use App\Models\Workspace;
use Carbon\CarbonImmutable;

test('get_calendar returns scheduled posts within the month window', function (): void {
    $user = User::factory()->create();
    $workspace = Workspace::factory()->create();
    $user->forceFill(['current_workspace_id' => $workspace->id])->save();
    bindTokenToWorkspace($user, $workspace);

    Post::factory()->for($workspace)->create([
        'base_text' => 'scheduled one',
        'status' => PostStatus::Scheduled->value,
        'scheduled_at' => CarbonImmutable::parse('2026-06-15 10:00:00'),
    ]);

    $response = ShoutrrrServer::actingAs($user)->tool(GetCalendarTool::class, ['month' => '2026-06']);
    $response->assertOk()->assertSee('scheduled one');
});

test('get_calendar rejects a malformed month', function (): void {
    $user = User::factory()->create();
    $workspace = Workspace::factory()->create();
    $user->forceFill(['current_workspace_id' => $workspace->id])->save();
    bindTokenToWorkspace($user, $workspace);

    $response = ShoutrrrServer::actingAs($user)->tool(GetCalendarTool::class, ['month' => 'June']);
    $response->assertHasErrors();
});
