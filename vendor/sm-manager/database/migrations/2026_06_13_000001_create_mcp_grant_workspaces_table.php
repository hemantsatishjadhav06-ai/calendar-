<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('mcp_grant_workspaces', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('user_id')->constrained()->cascadeOnDelete();
            $table->string('client_id')->index();
            $table->foreignUuid('workspace_id')->constrained()->cascadeOnDelete();
            // Null until the AccessTokenCreated listener stamps it. Token ids are
            // 80-char strings in Passport.
            $table->string('access_token_id', 100)->nullable()->unique();
            $table->timestamps();

            // One pending (unstamped) binding per user+client; stamping fills token id.
            $table->unique(['user_id', 'client_id', 'access_token_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('mcp_grant_workspaces');
    }
};
