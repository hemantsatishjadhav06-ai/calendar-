<?php

declare(strict_types=1);

namespace App\Models;

use Database\Factories\ConnectedAccountSecretFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\WithoutIncrementing;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Override;

/**
 * @property string $connected_account_id
 * @property string|null $access_token
 * @property string|null $refresh_token
 * @property string|null $app_password
 * @property array<string, mixed>|null $session
 */
#[Fillable([
    'connected_account_id',
    'access_token',
    'refresh_token',
    'app_password',
    'session',
])]
#[WithoutIncrementing]
class ConnectedAccountSecret extends Model
{
    /** @use HasFactory<ConnectedAccountSecretFactory> */
    use HasFactory;

    #[Override]
    protected $primaryKey = 'connected_account_id';

    #[Override]
    protected $keyType = 'string';

    /**
     * @return array<string, string>
     */
    #[Override]
    protected function casts(): array
    {
        return [
            'access_token' => 'encrypted',
            'refresh_token' => 'encrypted',
            'app_password' => 'encrypted',
            'session' => 'encrypted:array',
        ];
    }

    /**
     * @return BelongsTo<ConnectedAccount, $this>
     */
    public function account(): BelongsTo
    {
        return $this->belongsTo(ConnectedAccount::class, 'connected_account_id');
    }
}
