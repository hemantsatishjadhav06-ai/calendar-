<?php

use App\Models\SocialAccount;
use App\Models\User;
use Inertia\Testing\AssertableInertia as Assert;

test('enabled provider keys are shared globally for the settings nav gate', function () {
    config()->set('kit.auth.socialite.providers', ['google']);

    $this->actingAs(User::factory()->create())
        ->get(route('connections.edit'))
        ->assertInertia(fn (Assert $page) => $page->where('socialite.providers', ['google']));

    config()->set('kit.auth.socialite.enabled', false);

    $this->actingAs(User::factory()->create())
        ->get(route('profile.edit'))
        ->assertInertia(fn (Assert $page) => $page->where('socialite.providers', []));
});

test('connections page lists enabled providers and link state', function () {
    config()->set('kit.auth.socialite.providers', ['google']);

    $user = User::factory()->create();
    SocialAccount::factory()->create(['user_id' => $user->id, 'provider' => 'google']);

    $this->actingAs($user)
        ->get(route('connections.edit'))
        ->assertInertia(fn (Assert $page) => $page
            ->component('settings/connections')
            ->where('hasPassword', true)
            ->has('connections', 1)
            ->where('connections.0.provider', 'google')
            ->where('connections.0.connected', true)
            ->where('connections.0.id', $user->socialAccounts()->first()->id),
        );
});

test('connections page is reachable by an oauth-only user without password confirmation', function () {
    $user = User::factory()->create(['password' => null]);
    SocialAccount::factory()->create(['user_id' => $user->id, 'provider' => 'google']);

    $this->actingAs($user)
        ->get(route('connections.edit'))
        ->assertOk();
});

test('a provider can be disconnected when another login method remains', function () {
    $user = User::factory()->create(); // has password
    $account = SocialAccount::factory()->create(['user_id' => $user->id, 'provider' => 'google']);

    $this->actingAs($user)
        ->delete(route('connections.destroy', $account))
        ->assertRedirect()
        ->assertSessionHas('success');

    expect(SocialAccount::find($account->id))->toBeNull();
});

test('disconnecting the only login method is rejected', function () {
    $user = User::factory()->create(['password' => null]); // no password
    $account = SocialAccount::factory()->create(['user_id' => $user->id, 'provider' => 'google']);

    $this->actingAs($user)
        ->delete(route('connections.destroy', $account))
        ->assertSessionHas('error');

    expect(SocialAccount::find($account->id))->not->toBeNull();
});

test('a user cannot disconnect another users social account', function () {
    $user = User::factory()->create();
    $otherAccount = SocialAccount::factory()->create();

    $this->actingAs($user)
        ->delete(route('connections.destroy', $otherAccount))
        ->assertForbidden();
});
