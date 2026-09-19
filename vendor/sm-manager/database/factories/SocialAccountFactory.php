<?php

namespace Database\Factories;

use App\Enums\SocialProvider;
use App\Models\SocialAccount;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<SocialAccount>
 */
class SocialAccountFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'user_id' => User::factory(),
            'provider' => SocialProvider::Google->value,
            'provider_id' => (string) fake()->unique()->numerify('############'),
            'name' => fake()->name(),
            'nickname' => fake()->userName(),
            'avatar' => fake()->imageUrl(),
        ];
    }

    public function forProvider(SocialProvider $provider): static
    {
        return $this->state(fn (array $attributes): array => [
            'provider' => $provider->value,
        ]);
    }
}
