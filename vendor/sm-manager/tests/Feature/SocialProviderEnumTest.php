<?php

use App\Enums\SocialProvider;

test('google provider resolves from a valid enabled key', function () {
    config()->set('kit.auth.socialite.enabled', true);
    config()->set('kit.auth.socialite.providers', ['google']);

    $provider = SocialProvider::fromEnabled('google');

    expect($provider)->toBe(SocialProvider::Google)
        ->and($provider->label())->toBe('Google');
});

test('unknown provider key resolves to null', function () {
    expect(SocialProvider::fromEnabled('myspace'))->toBeNull();
});

test('disabled provider resolves to null even if the enum case exists', function () {
    config()->set('kit.auth.socialite.enabled', true);
    config()->set('kit.auth.socialite.providers', []);

    expect(SocialProvider::fromEnabled('google'))->toBeNull();
});

test('all providers resolve to null when socialite is disabled', function () {
    config()->set('kit.auth.socialite.enabled', false);
    config()->set('kit.auth.socialite.providers', ['google']);

    expect(SocialProvider::fromEnabled('google'))->toBeNull();
});

test('enabledProviders returns configured known providers and filters unknown ones', function () {
    config()->set('kit.auth.socialite.enabled', true);
    config()->set('kit.auth.socialite.providers', ['google', 'myspace']);

    expect(SocialProvider::enabledProviders())->toBe(['google']);
});

test('enabledProviders is empty when socialite is disabled', function () {
    config()->set('kit.auth.socialite.enabled', false);
    config()->set('kit.auth.socialite.providers', ['google']);

    expect(SocialProvider::enabledProviders())->toBe([]);
});

test('x and linkedin resolve with their labels when enabled', function () {
    config()->set('kit.auth.socialite.enabled', true);
    config()->set('kit.auth.socialite.providers', ['google', 'x', 'linkedin']);

    expect(SocialProvider::fromEnabled('x'))->toBe(SocialProvider::X)
        ->and(SocialProvider::X->label())->toBe('X')
        ->and(SocialProvider::fromEnabled('linkedin'))->toBe(SocialProvider::LinkedIn)
        ->and(SocialProvider::LinkedIn->label())->toBe('LinkedIn');
});

test('socialite driver names map the enum value to the backing driver', function () {
    expect(SocialProvider::Google->socialiteDriver())->toBe('google')
        ->and(SocialProvider::X->socialiteDriver())->toBe('x')
        ->and(SocialProvider::LinkedIn->socialiteDriver())->toBe('linkedin-openid');
});
