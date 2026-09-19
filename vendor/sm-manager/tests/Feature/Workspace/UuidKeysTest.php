<?php

use App\Models\User;
use Illuminate\Support\Str;

test('user primary key is a uuid', function () {
    $user = User::factory()->create();

    $this->assertTrue(Str::isUuid($user->id));
    $this->assertFalse($user->getIncrementing());
    $this->assertSame('string', $user->getKeyType());
});
