<?php

namespace Database\Factories;

use App\Models\User;
use App\Models\Workspace;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Str;
use Override;

/**
 * @extends Factory<Workspace>
 */
class WorkspaceFactory extends Factory
{
    #[Override]
    protected $model = Workspace::class;

    public function definition(): array
    {
        $name = fake()->unique()->company();

        return [
            'name' => $name,
            'slug' => Str::slug($name).'-'.Str::random(5),
            'logo' => null,
            'timezone' => 'UTC',
            'owner_id' => User::factory(),
        ];
    }
}
