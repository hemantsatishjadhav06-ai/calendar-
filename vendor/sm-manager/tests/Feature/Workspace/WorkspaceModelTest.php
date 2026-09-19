<?php

use App\Models\User;
use App\Models\Workspace;
use Illuminate\Support\Str;

test('workspace has uuid and owner relation', function () {
    $owner = User::factory()->create();
    $workspace = Workspace::factory()->for($owner, 'owner')->create();

    $this->assertTrue(Str::isUuid($workspace->id));
    $this->assertTrue($owner->is($workspace->owner));
});

test('logo defaults to generated avatar', function () {
    $workspace = Workspace::factory()->create(['logo' => null]);

    $this->assertStringContainsString($workspace->id, $workspace->logo);
});
