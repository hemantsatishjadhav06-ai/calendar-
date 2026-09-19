<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('workspaces', function (Blueprint $table): void {
            $table->timestamp('onboarding_welcomed_at')->nullable()->after('timezone');
            $table->timestamp('onboarding_dismissed_at')->nullable()->after('onboarding_welcomed_at');
            // Completed onboarding step keys, e.g. ["connect_account","timezone"].
            $table->json('onboarding_progress')->nullable()->after('onboarding_dismissed_at');
        });
    }

    public function down(): void
    {
        Schema::table('workspaces', function (Blueprint $table): void {
            $table->dropColumn([
                'onboarding_welcomed_at',
                'onboarding_dismissed_at',
                'onboarding_progress',
            ]);
        });
    }
};
