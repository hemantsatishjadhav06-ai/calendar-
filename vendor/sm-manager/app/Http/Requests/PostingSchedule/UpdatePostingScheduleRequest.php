<?php

declare(strict_types=1);

namespace App\Http\Requests\PostingSchedule;

use App\Models\User;
use Illuminate\Foundation\Http\FormRequest;

class UpdatePostingScheduleRequest extends FormRequest
{
    public function authorize(): bool
    {
        /** @var User|null $user */
        $user = $this->user();

        if ($user === null) {
            return false;
        }

        return $user->hasAllPermissions(
            ['workspace.settings.manage'],
            $user->current_workspace_id,
        );
    }

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'slots' => ['array'],
            'slots.*.weekday' => ['required', 'integer', 'between:0,6'],
            'slots.*.hour' => ['required', 'integer', 'between:0,23'],
            'slots.*.minute' => ['nullable', 'integer', 'between:0,59'],
        ];
    }
}
