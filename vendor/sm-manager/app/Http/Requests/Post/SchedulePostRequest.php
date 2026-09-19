<?php

declare(strict_types=1);

namespace App\Http\Requests\Post;

use Illuminate\Foundation\Http\FormRequest;

class SchedulePostRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user()->can('update', $this->route('post'));
    }

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        // A null value un-schedules (back to draft); a present value must be in
        // the future — a post can't be scheduled (or rescheduled) into the past.
        return [
            'scheduled_at' => ['nullable', 'date', 'after:now'],
        ];
    }

    /**
     * @return array<string, string>
     */
    public function messages(): array
    {
        return [
            'scheduled_at.after' => 'Choose a time in the future — a post can\'t be scheduled in the past.',
        ];
    }
}
