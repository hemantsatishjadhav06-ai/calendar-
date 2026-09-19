<?php

use App\Mcp\Servers\ShoutrrrServer;
use App\Mcp\Tools\CreateAccountSetTool;
use App\Mcp\Tools\DeleteAccountSetTool;
use App\Mcp\Tools\UpdateAccountSetTool;
use App\Models\AccountSet;
use App\Models\ConnectedAccount;
use App\Models\User;
use App\Models\Workspace;

test('create, update, delete account set lifecycle', function (): void {
    $user = User::factory()->create();
    $workspace = Workspace::factory()->create();
    $user->forceFill(['current_workspace_id' => $workspace->id])->save();
    bindTokenToWorkspace($user, $workspace);
    $account = ConnectedAccount::factory()->for($workspace)->create();

    $created = ShoutrrrServer::actingAs($user)->tool(CreateAccountSetTool::class, [
        'name' => 'Launch', 'connected_account_ids' => [$account->id],
    ]);
    $created->assertOk()->assertSee('Launch');
    $set = AccountSet::query()->where('workspace_id', $workspace->id)->firstOrFail();

    $updated = ShoutrrrServer::actingAs($user)->tool(UpdateAccountSetTool::class, [
        'account_set_id' => $set->id, 'name' => 'Renamed', 'connected_account_ids' => [],
    ]);
    $updated->assertOk()->assertSee('Renamed');

    $deleted = ShoutrrrServer::actingAs($user)->tool(DeleteAccountSetTool::class, ['account_set_id' => $set->id]);
    $deleted->assertOk();
    expect(AccountSet::find($set->id))->toBeNull();
});
