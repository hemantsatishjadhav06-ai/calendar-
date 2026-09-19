<?php

declare(strict_types=1);

namespace App\Console\Commands;

use App\Models\McpGrantWorkspace;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

class PruneMcpBindings extends Command
{
    protected $signature = 'mcp:prune-bindings';

    protected $description = 'Remove abandoned pending MCP workspace bindings and bindings whose access token no longer exists.';

    public function handle(): int
    {
        $pending = McpGrantWorkspace::query()
            ->whereNull('access_token_id')
            ->where('created_at', '<', now()->subHour())
            ->delete();

        $orphaned = McpGrantWorkspace::query()
            ->whereNotNull('access_token_id')
            ->whereNotIn('access_token_id', DB::table('oauth_access_tokens')->select('id'))
            ->delete();

        $this->info("Pruned {$pending} pending and {$orphaned} orphaned bindings.");

        return self::SUCCESS;
    }
}
