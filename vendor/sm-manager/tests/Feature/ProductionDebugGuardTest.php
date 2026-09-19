<?php

use App\Providers\AppServiceProvider;

test('the app refuses to boot in production with debug enabled', function () {
    $this->app->detectEnvironment(fn () => 'production');
    config(['app.debug' => true]);

    expect(fn () => (new AppServiceProvider($this->app))->guardAgainstProductionDebug())
        ->toThrow(RuntimeException::class);
});

test('production with debug disabled boots fine', function () {
    $this->app->detectEnvironment(fn () => 'production');
    config(['app.debug' => false]);

    (new AppServiceProvider($this->app))->guardAgainstProductionDebug();

    expect(true)->toBeTrue();
});

test('local with debug enabled is allowed', function () {
    $this->app->detectEnvironment(fn () => 'local');
    config(['app.debug' => true]);

    (new AppServiceProvider($this->app))->guardAgainstProductionDebug();

    expect(true)->toBeTrue();
});
