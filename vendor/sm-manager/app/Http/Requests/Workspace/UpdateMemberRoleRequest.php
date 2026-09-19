<?php

declare(strict_types=1);

namespace App\Http\Requests\Workspace;

use App\Models\User;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Support\Facades\Context;
use Illuminate\Validation\Rule;

class UpdateMemberRoleRequest extends FormRequest
{
    public function authorize(): bool
    {
        /** @var User $user */
        $user = $this->user();

        return $user->hasAllPermissions(['workspace.users.manage'], Context::get('workspace_id'));
    }

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'role' => ['required', Rule::in(['member', 'admin'])],
        ];
    }
}
