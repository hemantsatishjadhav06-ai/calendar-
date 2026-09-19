<?php

use App\Http\Controllers\Auth\SocialiteController;
use Illuminate\Support\Facades\Route;

Route::prefix('auth')->group(function () {
    Route::get('{provider}/redirect', [SocialiteController::class, 'redirect'])
        ->middleware('throttle:10,1')
        ->name('auth.socialite.redirect');

    Route::get('{provider}/callback', [SocialiteController::class, 'callback'])
        ->middleware('throttle:10,1')
        ->name('auth.socialite.callback');
});
