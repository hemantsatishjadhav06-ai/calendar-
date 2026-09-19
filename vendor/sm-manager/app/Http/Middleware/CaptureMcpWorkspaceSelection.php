<?php

declare(strict_types=1);

namespace App\Http\Middleware;

use App\Models\McpGrantWorkspace;
use App\Models\User;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Records the workspace a user picked on the OAuth consent screen, keyed by
 * (user_id, client_id), so the AccessTokenCreated listener can stamp it onto the
 * issued access token. Runs on the consent approval POST only.
 */
class CaptureMcpWorkspaceSelection
{
    public function handle(Request $request, Closure $next): Response
    {
        // Skip on every route except the OAuth consent approval POST.
        // Using routeIs() means this guard is a no-op when no route is matched
        // (e.g. unit tests that invoke the middleware directly), and it short-
        // circuits all other matched routes — both cases are safe.
        if ($request->route() !== null && ! $request->routeIs('passport.authorizations.approve')) {
            return $next($request);
        }

        /** @var User|null $user */
        $user = $request->user();
        $workspaceId = $request->string('workspace_id')->toString();
        $clientId = $request->input('client_id') ?? $request->input('client');

        if ($user !== null && $workspaceId !== '' && $clientId !== null && $user->isMemberOfWorkspace($workspaceId)) {
            McpGrantWorkspace::updateOrCreate(
                ['user_id' => $user->id, 'client_id' => (string) $clientId, 'access_token_id' => null],
                ['workspace_id' => $workspaceId],
            );
        }

        return $next($request);
    }
}
