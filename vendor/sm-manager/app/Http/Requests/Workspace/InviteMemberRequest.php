<?php

declare(strict_types=1);

namespace App\Http\Requests\Workspace;

use App\Models\User;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Support\Facades\Context;
use Illuminate\Validation\Rule;

class InviteMemberRequest extends FormRequest
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
        $workspaceId = Context::get('workspace_id');

        return [
            'email' => [
                'required', 'email', 'max:255',
                Rule::unique('workspace_invitations', 'email')->where(
                    fn ($q) => $q->where('workspace_id', $workspaceId)
                        ->whereNull('accepted_at')
                        ->where('expires_at', '>', now())
                ),
            ],
            'role' => ['required', Rule::in(['member', 'admin'])],
        ];
    }
}
