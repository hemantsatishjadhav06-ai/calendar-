<?php

declare(strict_types=1);

namespace App\Enums;

enum SocialProvider: string
{
    case Google = 'google';
    case X = 'x';
    case LinkedIn = 'linkedin';

    /**
     * Resolve a provider from a route/key value, returning null when the
     * provider is unknown, not enabled in config, or Socialite is disabled.
     */
    public static function fromEnabled(string $value): ?self
    {
        $provider = self::tryFrom($value);

        if (! $provider instanceof self) {
            return null;
        }

        return in_array($provider->value, self::enabledProviders(), true) ? $provider : null;
    }

    /**
     * The provider keys enabled in config and backed by a known enum case.
     * Returns an empty list when Socialite is disabled.
     *
     * @return list<string>
     */
    public static function enabledProviders(): array
    {
        if (! config('kit.auth.socialite.enabled')) {
            return [];
        }

        /** @var list<string> $providers */
        $providers = config('kit.auth.socialite.providers', []);

        return array_values(array_filter(
            $providers,
            fn (string $value): bool => self::tryFrom($value) instanceof self,
        ));
    }

    /**
     * The enabled providers as `{provider, label}` pairs for the frontend, so
     * the display label has a single source of truth (this enum).
     *
     * @return list<array{provider: string, label: string}>
     */
    public static function enabledProvidersWithLabels(): array
    {
        return array_map(
            fn (string $key): array => [
                'provider' => $key,
                'label' => self::from($key)->label(),
            ],
            self::enabledProviders(),
        );
    }

    public function label(): string
    {
        return match ($this) {
            self::Google => 'Google',
            self::X => 'X',
            self::LinkedIn => 'LinkedIn',
        };
    }

    /**
     * The Socialite driver backing this provider. Usually identical to the enum
     * value, but LinkedIn uses the modern OpenID Connect driver, whose key
     * (`linkedin-openid`) differs from the clean route/DB token (`linkedin`).
     */
    public function socialiteDriver(): string
    {
        return match ($this) {
            self::LinkedIn => 'linkedin-openid',
            default => $this->value,
        };
    }
}
