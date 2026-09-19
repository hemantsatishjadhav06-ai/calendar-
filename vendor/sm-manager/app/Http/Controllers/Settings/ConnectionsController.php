<?php

declare(strict_types=1);

namespace App\Http\Controllers\Settings;

use App\Enums\SocialProvider;
use App\Http\Controllers\Controller;
use App\Models\SocialAccount;
use App\Models\User;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Inertia\Inertia;
use Inertia\Response;

class ConnectionsController extends Controller
{
    public function edit(Request $request): Response
    {
        $user = $request->user();

        $linkedAccounts = $user->socialAccounts()->get(['id', 'provider'])->keyBy('provider');

        $connections = collect(SocialProvider::enabledProviders())
            ->map(fn (string $key): array => [
                'provider' => $key,
                'label' => SocialProvider::from($key)->label(),
                'connected' => $linkedAccounts->has($key),
                'id' => $linkedAccounts->get($key)?->id,
            ])
            ->values()
            ->all();

        return Inertia::render('settings/connections', [
            'connections' => $connections,
            'hasPassword' => $user->hasPassword(),
        ]);
    }

    public function destroy(Request $request, SocialAccount $socialAccount): RedirectResponse
    {
        abort_unless($socialAccount->user_id === $request->user()->id, 403);

        // Lock the user row so concurrent disconnect requests can't both pass the
        // last-method check and leave the account with no way to sign in.
        $deleted = DB::transaction(function () use ($request, $socialAccount): bool {
            $user = User::query()->whereKey($request->user()->id)->lockForUpdate()->first();

            if (! $user || $user->loginMethodCount() <= 1) {
                return false;
            }

            $socialAccount->delete();

            return true;
        });

        if (! $deleted) {
            return back()->with('error', 'You cannot disconnect your only sign-in method. Set a password first.');
        }

        return back()->with('success', 'Account disconnected.');
    }
}
