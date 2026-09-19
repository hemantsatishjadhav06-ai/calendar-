<?php

declare(strict_types=1);

namespace App\Enums;

enum ConnectedAccountStatus: string
{
    case Active = 'active';
    case NeedsAttention = 'needs_attention';

    public function label(): string
    {
        return match ($this) {
            self::Active => 'Active',
            self::NeedsAttention => 'Needs attention',
        };
    }
}
