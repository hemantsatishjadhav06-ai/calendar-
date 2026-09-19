<?php

declare(strict_types=1);

namespace App\Services\Auth;

use App\Models\User;

final class SocialiteResult
{
    public function __construct(
        public User $user,
        public bool $wasRegistered,
    ) {}
}
