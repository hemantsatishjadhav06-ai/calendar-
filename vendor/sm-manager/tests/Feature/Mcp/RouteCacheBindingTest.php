<?php

use App\Http\Middleware\CaptureMcpWorkspaceSelection;
use Illuminate\Contracts\Http\Kernel;
use Illuminate\Support\Facades\Route;

test('consent approve route carries the capture middleware (cache-safe)', function (): void {
    $route = Route::getRoutes()->getByName('passport.authorizations.approve');

    expect($route)->not->toBeNull();

    // The approve route uses the `web` middleware group (statically registered in
    // Passport's routes file). CaptureMcpWorkspaceSelection is appended to that
    // group in bootstrap/app.php — this approach survives route:cache because the
    // group membership is resolved at boot, not via a runtime mutation.
    $routeMiddleware = $route->gatherMiddleware();
    expect($routeMiddleware)->toContain('web');

    $webGroup = app(Kernel::class)->getMiddlewareGroups()['web'] ?? [];
    expect($webGroup)->toContain(CaptureMcpWorkspaceSelection::class);
});
