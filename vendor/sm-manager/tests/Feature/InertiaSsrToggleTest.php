<?php

test('inertia ssr is disabled by default', function () {
    expect(config('inertia.ssr.enabled'))->toBeFalse();
});

test('inertia ssr bundle points at the built ssr bundle', function () {
    expect(config('inertia.ssr.bundle'))->toBe(base_path('bootstrap/ssr/ssr.mjs'));
});
