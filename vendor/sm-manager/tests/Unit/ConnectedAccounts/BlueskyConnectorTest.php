<?php

use App\Enums\Platform;
use App\Services\ConnectedAccounts\BlueskyConnector;
use Illuminate\Http\Client\Factory as HttpFactory;
use Illuminate\Support\Facades\Http;

function connector(): BlueskyConnector
{
    return new BlueskyConnector(app(HttpFactory::class));
}

test('resolvePds uses a manual override verbatim, normalized', function () {
    expect(connector()->resolvePds('ada.example.com', 'https://pds.example.com/'))
        ->toBe('https://pds.example.com');
});

test('resolvePds rejects unsafe override URLs to prevent SSRF', function (string $override) {
    expect(fn () => connector()->resolvePds('ada.example.com', $override))
        ->toThrow(RuntimeException::class);
})->with([
    'plain http' => 'http://bsky.social',
    'localhost' => 'https://localhost',
    'loopback ip' => 'https://127.0.0.1',
    'link-local metadata' => 'https://169.254.169.254',
    'private range' => 'https://10.0.0.5',
    'internal tld' => 'https://pds.internal',
]);

test('resolvePds resolves the handle to its DID and PDS service endpoint', function () {
    Http::fake([
        '*xrpc/com.atproto.identity.resolveHandle*' => Http::response(['did' => 'did:plc:abc']),
        '*plc.directory/did:plc:abc' => Http::response([
            'service' => [
                ['id' => '#atproto_pds', 'type' => 'AtprotoPersonalDataServer', 'serviceEndpoint' => 'https://pds.host'],
            ],
        ]),
    ]);

    expect(connector()->resolvePds('ada.example.com', null))->toBe('https://pds.host');
});

test('resolvePds falls back to bsky.social when resolution fails', function () {
    Http::fake([
        '*xrpc/com.atproto.identity.resolveHandle*' => Http::response([], 400),
    ]);

    expect(connector()->resolvePds('nope.invalid', null))->toBe('https://bsky.social');
});

test('connect creates a session and returns a dto with the app password and session blob', function () {
    Http::fake([
        '*xrpc/com.atproto.server.createSession' => Http::response([
            'did' => 'did:plc:abc',
            'handle' => 'ada.bsky.social',
            'accessJwt' => 'access-jwt',
            'refreshJwt' => 'refresh-jwt',
        ]),
        '*xrpc/app.bsky.actor.getProfile*' => Http::response([
            'did' => 'did:plc:abc',
            'handle' => 'ada.bsky.social',
            'displayName' => 'Ada Lovelace',
            'avatar' => 'https://cdn.bsky/ada.jpg',
        ]),
    ]);

    $data = connector()->connect('ada.bsky.social', 'app-pass-1234', 'https://bsky.social');

    expect($data->platform)->toBe(Platform::Bluesky)
        ->and($data->remoteAccountId)->toBe('did:plc:abc')
        ->and($data->handle)->toBe('@ada.bsky.social')
        ->and($data->displayName)->toBe('Ada Lovelace')
        ->and($data->avatarUrl)->toBe('https://cdn.bsky/ada.jpg')
        ->and($data->authMethod)->toBe('app_password')
        ->and($data->appPassword)->toBe('app-pass-1234')
        ->and($data->session)->toMatchArray(['accessJwt' => 'access-jwt', 'refreshJwt' => 'refresh-jwt']);
});
