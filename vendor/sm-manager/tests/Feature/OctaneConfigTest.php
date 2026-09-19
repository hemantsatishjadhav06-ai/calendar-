<?php

use Laravel\Octane\Octane;

test('octane package is installed', function () {
    expect(class_exists(Octane::class))->toBeTrue();
});

test('octane is configured to use the frankenphp server', function () {
    expect(config('octane'))->toBeArray()
        ->and(config('octane.server'))->toBe('frankenphp');
});
