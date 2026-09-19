<?php

declare(strict_types=1);

namespace App\Enums;

enum WorkspaceRole: string
{
    case Owner = 'owner';
    case Admin = 'admin';
    case Member = 'member';

    /**
     * @return array<int, string>
     */
    public function permissions(): array
    {
        return config('kit.workspaces.roles.'.$this->value.'.permissions', []);
    }

    public function label(): string
    {
        return ucfirst($this->value);
    }

    /**
     * Roles that may be assigned to invited members (owner is implicit).
     *
     * @return array<int, self>
     */
    public static function assignable(): array
    {
        return [self::Admin, self::Member];
    }
}
