<?php

declare(strict_types=1);

namespace App\Exceptions;

use Exception;

/**
 * Thrown when an OAuth callback cannot be resolved safely (e.g. email belongs
 * to an existing unverified-match account, or the identity is already linked
 * elsewhere). The message is safe to surface to the user as a flash error.
 */
final class SocialAuthException extends Exception
{
    public static function emailTaken(string $providerLabel): self
    {
        return new self(
            "An account with this email already exists. Log in with your existing method, then connect {$providerLabel} from your settings.",
        );
    }

    public static function alreadyLinkedElsewhere(string $providerLabel): self
    {
        return new self(
            "This {$providerLabel} account is already connected to a different account.",
        );
    }

    public static function missingEmail(string $providerLabel): self
    {
        return new self(
            "Your {$providerLabel} account did not share an email address, which is required to sign in.",
        );
    }

    public static function couldNotComplete(string $providerLabel): self
    {
        return new self(
            "We could not complete your {$providerLabel} sign-in. Please try again.",
        );
    }

    public static function registrationsDisabled(): self
    {
        return new self('Registration is disabled for this instance.');
    }
}
