<?php

declare(strict_types=1);

namespace App\Models;

use Database\Factories\WorkspaceInvitationFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Str;
use Override;

#[Fillable([
    'workspace_id',
    'invited_by',
    'email',
    'role',
    'token',
    'expires_at',
    'accepted_at',
])]
class WorkspaceInvitation extends Model
{
    /** @use HasFactory<WorkspaceInvitationFactory> */
    use HasFactory, HasUuids;

    #[Override]
    protected function casts(): array
    {
        return [
            'expires_at' => 'datetime',
            'accepted_at' => 'datetime',
        ];
    }

    /**
     * Returns [plaintext, sha256-hash]. Store the hash; email the plaintext.
     *
     * @return array{0: string, 1: string}
     */
    public static function generateToken(): array
    {
        $plain = Str::random(64);

        return [$plain, hash('sha256', $plain)];
    }

    public static function findByToken(string $plain): ?self
    {
        return self::where('token', hash('sha256', $plain))->first();
    }

    /**
     * @return BelongsTo<Workspace, $this>
     */
    public function workspace(): BelongsTo
    {
        return $this->belongsTo(Workspace::class);
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function inviter(): BelongsTo
    {
        return $this->belongsTo(User::class, 'invited_by');
    }

    public function isExpired(): bool
    {
        return $this->expires_at->isPast();
    }

    public function isAccepted(): bool
    {
        return $this->accepted_at !== null;
    }

    public function isValid(): bool
    {
        return ! $this->isExpired() && ! $this->isAccepted();
    }

    public function markAsAccepted(): void
    {
        $this->update(['accepted_at' => now()]);
    }

    /**
     * @param  Builder<WorkspaceInvitation>  $query
     * @return Builder<WorkspaceInvitation>
     */
    public function scopePending(Builder $query): Builder
    {
        return $query->whereNull('accepted_at')->where('expires_at', '>', now());
    }
}
