<?php

declare(strict_types=1);

namespace App\Dto\Workspace;

final class InvitationAcceptanceResult
{
    public function __construct(
        public bool $success,
        public string $message,
        public string $type, // 'success' | 'warning' | 'error'
    ) {}

    public function wasSuccessful(): bool
    {
        return $this->success;
    }
}
