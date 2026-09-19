<?php

namespace Database\Factories;

use App\Models\ConnectedAccount;
use App\Models\ConnectedAccountSecret;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<ConnectedAccountSecret>
 */
class ConnectedAccountSecretFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'connected_account_id' => ConnectedAccount::factory(),
            'access_token' => 'access-'.fake()->uuid(),
            'refresh_token' => 'refresh-'.fake()->uuid(),
            'app_password' => null,
            'session' => null,
        ];
    }
}
