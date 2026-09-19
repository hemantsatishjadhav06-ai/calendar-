<?php

use Illuminate\Support\Facades\Schema;

test('workspace tables and current workspace column exist', function () {
    $this->assertTrue(Schema::hasTable('workspaces'));
    $this->assertTrue(Schema::hasTable('workspace_memberships'));
    $this->assertTrue(Schema::hasTable('workspace_invitations'));
    $this->assertTrue(Schema::hasColumn('users', 'current_workspace_id'));
});
