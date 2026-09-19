<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use App\Enums\PostStatus;
use App\Models\Post;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Str;

class CommandSearchController extends Controller
{
    /**
     * Search the current workspace's posts by body text for the command palette.
     */
    public function __invoke(Request $request): JsonResponse
    {
        $user = $request->user();
        $query = trim((string) $request->query('q', ''));

        if ($user === null || $user->current_workspace_id === null || mb_strlen($query) < 2) {
            return response()->json(['posts' => []]);
        }

        $posts = Post::query()
            ->where('workspace_id', $user->current_workspace_id)
            ->whereNot('status', PostStatus::Deleted->value)
            ->whereLike('base_text', '%'.$query.'%')
            ->latest('updated_at')
            ->limit(8)
            ->get(['id', 'base_text', 'status', 'scheduled_at'])
            ->map(fn (Post $post): array => [
                'id' => $post->id,
                'excerpt' => Str::limit($post->base_text, 80),
                'status' => $post->status->value,
                'scheduled_at' => $post->scheduled_at?->toIso8601String(),
            ])->all();

        return response()->json(['posts' => $posts]);
    }
}
