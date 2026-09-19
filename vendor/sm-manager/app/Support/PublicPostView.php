<?php

declare(strict_types=1);

namespace App\Support;

use App\Models\Post;
use App\Models\PostMedia;
use App\Models\PostTarget;

final class PublicPostView
{
    /** @return array<string, mixed> */
    public static function make(Post $post): array
    {
        return [
            'base_text' => $post->base_text,
            'status' => $post->status->value,
            'scheduled_at' => $post->scheduled_at?->toIso8601String(),
            'created_at' => $post->created_at->toIso8601String(),
            'targets' => $post->targets->map(fn (PostTarget $t): array => [
                'platform' => $t->platform->value,
                'sections' => $t->sections,
                'status' => $t->status->value,
                'handle' => $t->account?->handle,
                'display_name' => $t->account?->display_name,
                'avatar_url' => $t->account?->avatar_url,
            ])->all(),
            'media' => $post->media->map(fn (PostMedia $m): array => [
                'id' => $m->id,
                'url' => $m->url(),
                'mime' => $m->mime,
                'alt_text' => $m->alt_text,
            ])->all(),
        ];
    }
}
