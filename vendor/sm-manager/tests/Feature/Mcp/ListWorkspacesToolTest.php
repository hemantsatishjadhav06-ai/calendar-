<?php

use App\Mcp\Servers\ShoutrrrServer;
use App\Mcp\Tools\ListWorkspacesTool;
use App\Models\User;
use App\Models\Workspace;
use App\Models\WorkspaceMembership;

test('list_workspaces shows the bound workspace and the users others', function (): void {
    $user = User::factory()->create();
    $bound = Workspace::factory()->create(['name' => 'Bound WS']);
    $other = Workspace::factory()->create(['name' => 'Other WS']);
    foreach ([$bound, $other] as $ws) {
        WorkspaceMembership::factory()->owner()->create([
            'user_id' => $user->id, 'workspace_id' => $ws->id,
        ]);
    }
    $user->forceFill(['current_workspace_id' => $bound->id])->save();
    bindTokenToWorkspace($user, $bound);

    $response = ShoutrrrServer::actingAs($user)->tool(ListWorkspacesTool::class, []);

    $response->assertOk()->assertSee('Bound WS')->assertSee('Other WS');
});
