<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('workspaces', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('owner_id')->constrained('users');
            $table->string('name');
            $table->string('slug')->unique();
            $table->longText('logo')->nullable();
            $table->string('timezone')->default('UTC');
            $table->timestamps();

            $table->index('owner_id');
        });

        Schema::table('users', function (Blueprint $table) {
            $table->foreignUuid('current_workspace_id')->nullable()->constrained('workspaces')->nullOnDelete();
        });

        Schema::create('workspace_memberships', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('workspace_id')->constrained('workspaces')->cascadeOnDelete();
            $table->foreignUuid('user_id')->constrained('users')->cascadeOnDelete();
            $table->string('role');
            $table->timestamps();

            $table->unique(['workspace_id', 'user_id']);
            $table->index(['workspace_id', 'role']);
        });

        Schema::create('workspace_invitations', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('workspace_id')->constrained('workspaces')->cascadeOnDelete();
            $table->foreignUuid('invited_by')->nullable()->constrained('users')->nullOnDelete();
            $table->string('email');
            $table->string('role');
            $table->string('token')->unique();
            $table->timestamp('expires_at');
            $table->timestamp('accepted_at')->nullable();
            $table->timestamps();

            $table->index(['email', 'workspace_id']);
            $table->index('token');
        });
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->dropConstrainedForeignId('current_workspace_id');
        });

        Schema::dropIfExists('workspace_invitations');
        Schema::dropIfExists('workspace_memberships');
        Schema::dropIfExists('workspaces');
    }
};
