<?php

declare(strict_types=1);

namespace App\Http\Controllers\Posts;

use App\Http\Controllers\Controller;
use App\Models\Post;
use App\Models\PostShare;
use App\Services\Posts\ShareService;
use Carbon\CarbonImmutable;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class PostShareController extends Controller
{
    public function __construct(private readonly ShareService $shares) {}

    public function index(Request $request, Post $post): JsonResponse
    {
        abort_unless($request->user()?->can('update', $post), 403);

        $rows = $post->shares()
            ->whereNull('revoked_at')
            ->where(fn ($q) => $q->whereNull('expires_at')->orWhere('expires_at', '>', now()))
            ->latest()
            ->get()
            ->map(fn (PostShare $s): array => [
                'id' => $s->id,
                'expires_at' => $s->expires_at?->toIso8601String(),
                'created_at' => $s->created_at->toIso8601String(),
            ]);

        return response()->json($rows);
    }

    public function store(Request $request, Post $post): JsonResponse
    {
        abort_unless($request->user()?->can('update', $post), 403);

        $validated = $request->validate(['expires_at' => ['nullable', 'date']]);

        $expiresAt = $validated['expires_at'] ?? null;
        [$share, $token] = $this->shares->mint(
            $post, $request->user(),
            $expiresAt !== null ? CarbonImmutable::parse($expiresAt) : null,
        );

        return response()->json([
            'id' => $share->id,
            'url' => $this->shares->url($token),
            'expires_at' => $share->expires_at?->toIso8601String(),
        ]);
    }

    public function destroy(Request $request, Post $post, PostShare $share): JsonResponse
    {
        abort_unless($request->user()?->can('update', $post), 403);
        abort_unless($share->post_id === $post->id, 404);

        $share->forceFill(['revoked_at' => now()])->save();

        return response()->json(status: 204);
    }
}
