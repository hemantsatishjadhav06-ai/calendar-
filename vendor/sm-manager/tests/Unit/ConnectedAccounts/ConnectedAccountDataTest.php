<?php

use App\Dto\ConnectedAccount\ConnectedAccountData;
use App\Enums\Platform;
use Carbon\CarbonImmutable;
use Laravel\Socialite\Two\User as SocialiteUser;

test('it maps an X socialite user into a connected account dto', function () {
    $oauthUser = (new SocialiteUser)
        ->map([
            'id' => 'x-123',
            'nickname' => 'ada',
            'name' => 'Ada Lovelace',
            'avatar' => 'https://x.com/ada.png',
        ])
        ->setToken('access-tok')
        ->setRefreshToken('refresh-tok')
        ->setExpiresIn(7200);

    $data = ConnectedAccountData::fromSocialite(Platform::X, $oauthUser);

    expect($data->platform)->toBe(Platform::X)
        ->and($data->remoteAccountId)->toBe('x-123')
        ->and($data->handle)->toBe('@ada')
        ->and($data->displayName)->toBe('Ada Lovelace')
        ->and($data->avatarUrl)->toBe('https://x.com/ada.png')
        ->and($data->authMethod)->toBe('oauth')
        ->and($data->accessToken)->toBe('access-tok')
        ->and($data->refreshToken)->toBe('refresh-tok')
        ->and($data->tokenExpiresAt)->toBeInstanceOf(CarbonImmutable::class);
});

test('it maps a linkedin socialite user, falling back to name for the handle', function () {
    $oauthUser = (new SocialiteUser)
        ->map([
            'id' => 'sub-789',
            'nickname' => null,
            'name' => 'Grace Hopper',
            'avatar' => null,
        ])
        ->setToken('li-tok')
        ->setExpiresIn(5184000);

    $data = ConnectedAccountData::fromSocialite(Platform::LinkedIn, $oauthUser);

    expect($data->remoteAccountId)->toBe('sub-789')
        ->and($data->handle)->toBe('Grace Hopper')
        ->and($data->refreshToken)->toBeNull()
        ->and($data->appPassword)->toBeNull();
});
