<?php

declare(strict_types=1);

namespace App\Support\Notifications;

use App\Enums\NotificationType;

final class NotificationPreferences
{
    /**
     * @param  array<string, array{in_app: bool, mail: bool}>  $matrix
     */
    private function __construct(private array $matrix) {}

    public static function defaults(): self
    {
        $matrix = [];

        foreach (NotificationType::cases() as $type) {
            $matrix[$type->value] = ['in_app' => true, 'mail' => $type->emailOnByDefault()];
        }

        return new self($matrix);
    }

    /**
     * @param  array<string, mixed>|null  $data
     */
    public static function fromArray(?array $data): self
    {
        $prefs = self::defaults();

        if ($data === null) {
            return $prefs;
        }

        foreach (NotificationType::cases() as $type) {
            $row = $data[$type->value] ?? null;

            if (! is_array($row)) {
                continue;
            }

            $prefs->matrix[$type->value] = [
                'in_app' => (bool) ($row['in_app'] ?? true),
                'mail' => (bool) ($row['mail'] ?? $type->emailOnByDefault()),
            ];
        }

        return $prefs;
    }

    public function allows(NotificationType $type, string $channel): bool
    {
        if ($channel === 'in_app' && $type->inAppAlwaysOn()) {
            return true;
        }

        return (bool) ($this->matrix[$type->value][$channel] ?? true);
    }

    /**
     * @return array<int, string>
     */
    public function channelsFor(NotificationType $type): array
    {
        $channels = [];

        if ($this->allows($type, 'in_app')) {
            $channels[] = 'database';
        }

        if ($this->allows($type, 'mail')) {
            $channels[] = 'mail';
        }

        return $channels;
    }

    /**
     * @return array<string, array{in_app: bool, mail: bool}>
     */
    public function toArray(): array
    {
        return $this->matrix;
    }
}
