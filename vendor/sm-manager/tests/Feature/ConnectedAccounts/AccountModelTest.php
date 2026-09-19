<?php

use App\Enums\ConnectedAccountStatus;
use App\Enums\Platform;
use App\Models\ConnectedAccount;
use App\Models\ConnectedAccountSecret;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;

test('connected account casts platform and status to enums', function () {
    $account = ConnectedAccount::factory()->create([
        'platform' => Platform::Bluesky->value,
        'status' => ConnectedAccountStatus::NeedsAttention->value,
    ]);

    expect($account->platform)->toBe(Platform::Bluesky)
        ->and($account->status)->toBe(ConnectedAccountStatus::NeedsAttention);
});

test('secret columns are encrypted at rest', function () {
    $account = ConnectedAccount::factory()->create();

    ConnectedAccountSecret::factory()->create([
        'connected_account_id' => $account->id,
        'access_token' => 'super-secret-token',
    ]);

    $rawCiphertext = DB::table('connected_account_secrets')
        ->where('connected_account_id', $account->id)
        ->value('access_token');

    expect($rawCiphertext)->not->toBe('super-secret-token')
        ->and(Crypt::decryptString($rawCiphertext))->toBe('super-secret-token')
        ->and($account->secret->access_token)->toBe('super-secret-token');
});

test('the unique constraint upserts the same remote account per workspace', function () {
    $account = ConnectedAccount::factory()->create([
        'platform' => Platform::X->value,
        'remote_account_id' => 'remote-1',
    ]);

    $upsert = fn () => ConnectedAccount::withoutGlobalScopes()->updateOrCreate(
        [
            'workspace_id' => $account->workspace_id,
            'platform' => Platform::X->value,
            'remote_account_id' => 'remote-1',
        ],
        ['handle' => '@renamed'],
    );

    $upsert();

    expect(ConnectedAccount::withoutGlobalScopes()->count())->toBe(1)
        ->and($account->fresh()->handle)->toBe('@renamed');
});
