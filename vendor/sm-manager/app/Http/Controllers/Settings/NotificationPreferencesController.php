<?php

declare(strict_types=1);

namespace App\Http\Controllers\Settings;

use App\Enums\NotificationType;
use App\Http\Controllers\Controller;
use App\Http\Requests\Settings\UpdateNotificationPreferencesRequest;
use App\Support\Notifications\NotificationPreferences;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

class NotificationPreferencesController extends Controller
{
    /**
     * Show the notification preferences settings page.
     */
    public function edit(Request $request): Response
    {
        return Inertia::render('settings/notifications', [
            'preferences' => $request->user()->notificationPreferences()->toArray(),
            'alwaysOn' => collect(NotificationType::cases())
                ->filter(fn (NotificationType $t): bool => $t->inAppAlwaysOn())
                ->map(fn (NotificationType $t): string => $t->value)
                ->values()
                ->all(),
        ]);
    }

    /**
     * Update the user's notification preferences.
     */
    public function update(UpdateNotificationPreferencesRequest $request): RedirectResponse
    {
        $request->user()->update([
            'notification_preferences' => NotificationPreferences::fromArray(
                $request->validated('preferences'),
            ),
        ]);

        Inertia::flash('toast', ['type' => 'success', 'message' => __('Notification preferences updated.')]);

        return to_route('notifications.preferences');
    }
}
