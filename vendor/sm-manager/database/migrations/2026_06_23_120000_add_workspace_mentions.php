<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('workspace_mentions', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('workspace_id')->constrained('workspaces')->cascadeOnDelete();
            $table->string('name');
            $table->json('handles');
            $table->timestamps();

            $table->unique(['workspace_id', 'name']);
        });

        Schema::table('posts', function (Blueprint $table): void {
            $table->json('mentions')->nullable()->after('base_text');
        });
    }

    public function down(): void
    {
        Schema::table('posts', function (Blueprint $table): void {
            $table->dropColumn('mentions');
        });

        Schema::dropIfExists('workspace_mentions');
    }
};
