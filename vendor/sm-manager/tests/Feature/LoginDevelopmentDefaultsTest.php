<?php

use Inertia\Testing\AssertableInertia as Assert;

it('prefills the login form with development default credentials in local', function (): void {
    $this->app->detectEnvironment(fn () => 'local');

    $this->get(route('login'))
        ->assertInertia(fn (Assert $page) => $page
            ->component('auth/login')
            ->where('defaultLogin.email', 'test@example.com')
            ->where('defaultLogin.password', 'password'));
});

it('does not expose development default credentials outside local', function (): void {
    $this->app->detectEnvironment(fn () => 'production');

    $this->get(route('login'))
        ->assertInertia(fn (Assert $page) => $page
            ->component('auth/login')
            ->missing('defaultLogin'));
});
