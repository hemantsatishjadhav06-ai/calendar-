<?php

use App\Models\WorkspaceInvitation;

test('token is stored hashed and found by plaintext', function () {
    [$plain, $hash] = WorkspaceInvitation::generateToken();
    $invitation = WorkspaceInvitation::factory()->create(['token' => $hash]);

    $this->assertNotSame($plain, $invitation->token);
    $this->assertTrue(WorkspaceInvitation::findByToken($plain)->is($invitation));
});

test('validity reflects expiry and acceptance', function () {
    $valid = WorkspaceInvitation::factory()->create();
    $expired = WorkspaceInvitation::factory()->expired()->create();
    $accepted = WorkspaceInvitation::factory()->create(['accepted_at' => now()]);

    $this->assertTrue($valid->isValid());
    $this->assertFalse($expired->isValid());
    $this->assertFalse($accepted->isValid());
});
