<?php

declare(strict_types=1);

namespace App\Events;

use App\Models\ConnectedAccount;
use Illuminate\Foundation\Events\Dispatchable;

final readonly class ConnectedAccountConnected
{
    use Dispatchable;

    public function __construct(public ConnectedAccount $account) {}
}
