<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Adds standalone indexes for hot foreign-key / filter columns. On Postgres
 * (the production target) `constrained()` does NOT auto-index the referencing
 * column, so these are missing for several frequently-joined columns.
 *
 * Note: post_targets(post_id) and the metrics tables' *_id columns are
 * deliberately omitted — they are already the leftmost column of an existing
 * composite UNIQUE index, which serves those lookups.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('post_targets', function (Blueprint $table): void {
            // Not the leftmost column of unique(post_id, connected_account_id),
            // so account-scoped lookups/joins are unindexed.
            $table->index('connected_account_id', 'post_targets_connected_account_id_index');
        });

        Schema::table('posts', function (Blueprint $table): void {
            // DispatchDuePosts filters status = scheduled AND scheduled_at BETWEEN …;
            // the existing (workspace_id, status) index doesn't help that range scan.
            $table->index(['status', 'scheduled_at'], 'posts_status_scheduled_at_index');
        });

        Schema::table('post_shares', function (Blueprint $table): void {
            $table->index('post_id', 'post_shares_post_id_index');
        });

        Schema::table('post_media', function (Blueprint $table): void {
            $table->index('post_id', 'post_media_post_id_index');
        });
    }

    public function down(): void
    {
        Schema::table('post_targets', function (Blueprint $table): void {
            $table->dropIndex('post_targets_connected_account_id_index');
        });

        Schema::table('posts', function (Blueprint $table): void {
            $table->dropIndex('posts_status_scheduled_at_index');
        });

        Schema::table('post_shares', function (Blueprint $table): void {
            $table->dropIndex('post_shares_post_id_index');
        });

        Schema::table('post_media', function (Blueprint $table): void {
            $table->dropIndex('post_media_post_id_index');
        });
    }
};
