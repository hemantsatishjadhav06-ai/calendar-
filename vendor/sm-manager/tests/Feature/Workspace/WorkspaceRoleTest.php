<?php

use App\Enums\WorkspaceRole;

test('owner role has management permissions', function () {
    $permissions = WorkspaceRole::Owner->permissions();

    $this->assertContains('workspace.users.manage', $permissions);
    $this->assertContains('workspace.delete', $permissions);
});

test('member role is read only', function () {
    $this->assertSame(['workspace.read'], WorkspaceRole::Member->permissions());
});

test('assignable roles exclude owner', function () {
    $values = array_map(fn ($r) => $r->value, WorkspaceRole::assignable());

    $this->assertSame(['admin', 'member'], $values);
});
