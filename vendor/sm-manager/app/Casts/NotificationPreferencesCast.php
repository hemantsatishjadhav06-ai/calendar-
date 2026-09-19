<?php

declare(strict_types=1);

namespace App\Casts;

use App\Support\Notifications\NotificationPreferences;
use Illuminate\Contracts\Database\Eloquent\CastsAttributes;
use Illuminate\Database\Eloquent\Model;

/**
 * @implements CastsAttributes<NotificationPreferences, NotificationPreferences|array<string, mixed>>
 */
class NotificationPreferencesCast implements CastsAttributes
{
    /**
     * @param  array<string, mixed>  $attributes
     */
    public function get(Model $model, string $key, mixed $value, array $attributes): NotificationPreferences
    {
        return NotificationPreferences::fromArray(
            is_string($value) ? json_decode($value, true) : null,
        );
    }

    /**
     * @param  NotificationPreferences|array<string, mixed>|null  $value
     * @param  array<string, mixed>  $attributes
     */
    public function set(Model $model, string $key, mixed $value, array $attributes): string
    {
        $prefs = $value instanceof NotificationPreferences
            ? $value
            : NotificationPreferences::fromArray(is_array($value) ? $value : null);

        return json_encode($prefs->toArray(), JSON_THROW_ON_ERROR);
    }
}
