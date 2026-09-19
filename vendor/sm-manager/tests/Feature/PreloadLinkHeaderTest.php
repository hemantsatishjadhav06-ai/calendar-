<?php

use Illuminate\Http\Middleware\AddLinkHeadersForPreloadedAssets;

test('the Vite preload Link header middleware is not registered on the web group', function () {
    // Under Octane behind a TLS-terminating proxy this middleware emits a
    // frozen http:// `Link: rel=preload` header that the browser blocks as mixed
    // content. It is redundant with the in-document <link rel="modulepreload">
    // tags, so it must stay unregistered.
    $webGroup = app('router')->getMiddlewareGroups()['web'] ?? [];

    expect($webGroup)->not->toContain(AddLinkHeadersForPreloadedAssets::class);
});
