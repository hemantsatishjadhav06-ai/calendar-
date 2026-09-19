<?php

namespace Database\Factories;

use App\Models\Post;
use App\Models\PostShare;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;

/** @extends Factory<PostShare> */
class PostShareFactory extends Factory
{
    /** @return array<string, mixed> */
    public function definition(): array
    {
        return [
            'post_id' => Post::factory(),
            'created_by' => User::factory(),
            'token_hash' => hash('sha256', fake()->uuid()),
            'expires_at' => null,
            'revoked_at' => null,
        ];
    }

    public function expired(): static
    {
        return $this->state(fn (): array => ['expires_at' => now()->subDay()]);
    }

    public function revoked(): static
    {
        return $this->state(fn (): array => ['revoked_at' => now()->subHour()]);
    }
}
