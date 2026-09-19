<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use App\Support\Notifications\NotificationPresenter;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;

class NotificationController extends Controller
{
    /**
     * Return a cursor-paginated page of notifications for infinite scroll.
     *
     * The bell dropdown seeds its first page from the shared Inertia prop and
     * calls this endpoint to load older notifications as the user scrolls.
     */
    public function index(Request $request): JsonResponse
    {
        $cursor = $request->query('cursor');

        return response()->json(NotificationPresenter::collection(
            $request->user(),
            $request->user()->current_workspace_id,
            is_string($cursor) ? $cursor : null,
        ));
    }

    /**
     * Mark a single notification as read.
     *
     * Only the owning user's notifications are accessible; the relation
     * scopes the query so a 404 is returned for cross-user access.
     */
    public function markRead(Request $request, string $notification): RedirectResponse|Response
    {
        $record = $request->user()->notifications()->findOrFail($notification);
        $record->markAsRead();

        if ($request->expectsJson()) {
            return response()->noContent();
        }

        return back();
    }

    /**
     * Mark all unread notifications for the current workspace as read.
     */
    public function markAllRead(Request $request): RedirectResponse|Response
    {
        $workspaceId = $request->user()->current_workspace_id;

        $request->user()
            ->unreadNotifications()
            ->where(function ($query) use ($workspaceId): void {
                $query->where('data->workspace_id', $workspaceId)
                    ->orWhereNull('data->workspace_id');
            })
            ->update(['read_at' => now()]);

        if ($request->expectsJson()) {
            return response()->noContent();
        }

        return back();
    }

    /**
     * Delete a single notification.
     *
     * The user relation scopes access to owned notifications only.
     */
    public function destroy(Request $request, string $notification): RedirectResponse|Response
    {
        $request->user()->notifications()->findOrFail($notification)->delete();

        if ($request->expectsJson()) {
            return response()->noContent();
        }

        return back();
    }

    /**
     * Delete all notifications for the current workspace.
     */
    public function destroyAll(Request $request): RedirectResponse|Response
    {
        $workspaceId = $request->user()->current_workspace_id;

        $request->user()
            ->notifications()
            ->where(function ($query) use ($workspaceId): void {
                $query->where('data->workspace_id', $workspaceId)
                    ->orWhereNull('data->workspace_id');
            })
            ->delete();

        if ($request->expectsJson()) {
            return response()->noContent();
        }

        return back();
    }
}
