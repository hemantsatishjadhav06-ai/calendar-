<?php

use Illuminate\Support\Facades\Route;

test('missing pages render the custom inertia error page', function () {
    $this->get('/missing-page')
        ->assertNotFound()
        ->assertInertia(fn ($page) => $page
            ->component('error')
            ->where('status', 404));
});

test('browser error pages render while app debug is enabled', function () {
    config(['app.debug' => true]);

    Route::delete('/__test-debug-delete-only', fn () => response()->noContent());

    $this->get('/__test-debug-delete-only')
        ->assertNotFound()
        ->assertInertia(fn ($page) => $page
            ->component('error')
            ->where('status', 404));
});

test('http errors render the custom inertia error page', function (int $status) {
    Route::get("/__test-error-{$status}", fn () => abort($status));

    $this->get("/__test-error-{$status}")
        ->assertStatus($status)
        ->assertInertia(fn ($page) => $page
            ->component('error')
            ->where('status', $status));
})->with([
    'forbidden' => 403,
    'method not allowed' => 405,
    'expired' => 419,
    'server error' => 500,
    'maintenance' => 503,
]);

test('get requests to method-only routes render as not found for browser requests', function () {
    Route::delete('/__test-delete-only', fn () => response()->noContent());

    $this->get('/__test-delete-only')
        ->assertNotFound()
        ->assertInertia(fn ($page) => $page
            ->component('error')
            ->where('status', 404));
});

test('non-get method mismatches still render as method not allowed', function () {
    Route::get('/__test-get-only', fn () => response()->noContent());

    $this->post('/__test-get-only')
        ->assertMethodNotAllowed()
        ->assertInertia(fn ($page) => $page
            ->component('error')
            ->where('status', 405));
});

test('json error responses keep laravel json rendering', function () {
    $this->getJson('/missing-page')
        ->assertNotFound()
        ->assertJsonPath('message', 'The route missing-page could not be found.');
});
