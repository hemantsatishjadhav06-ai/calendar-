<?php

use App\Mcp\Servers\ShoutrrrServer;
use App\Mcp\Tools\ListAccountSetsTool;
use App\Models\AccountSet;
use App\Models\User;
use App\Models\Workspace;

test('list_account_sets returns sets in the bound workspace', function (): void {
    $user = User::factory()->create();
    $workspace = Workspace::factory()->create();
    $user->forceFill(['current_workspace_id' => $workspace->id])->save();
    bindTokenToWorkspace($user, $workspace);

    AccountSet::factory()->for($workspace)->create(['name' => 'Launch accounts']);

    $response = ShoutrrrServer::actingAs($user)->tool(ListAccountSetsTool::class, []);
    $response->assertOk()->assertSee('Launch accounts');
});
