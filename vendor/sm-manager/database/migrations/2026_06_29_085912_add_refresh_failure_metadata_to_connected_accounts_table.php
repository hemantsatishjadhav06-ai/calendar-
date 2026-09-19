<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('connected_accounts', function (Blueprint $table): void {
            $table->timestamp('refresh_failed_at')->nullable()->after('last_refreshed_at');
            $table->string('refresh_failure_reason')->nullable()->after('refresh_failed_at');
        });
    }

    public function down(): void
    {
        Schema::table('connected_accounts', function (Blueprint $table): void {
            $table->dropColumn(['refresh_failed_at', 'refresh_failure_reason']);
        });
    }
};
