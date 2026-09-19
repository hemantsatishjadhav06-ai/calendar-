<?php

use Illuminate\Support\Facades\Schema;

test('the performance indexes are present after migration', function () {
    $indexNames = fn (string $table): array => collect(Schema::getIndexes($table))
        ->pluck('name')
        ->all();

    expect($indexNames('post_targets'))->toContain('post_targets_connected_account_id_index');
    expect($indexNames('posts'))->toContain('posts_status_scheduled_at_index');
    expect($indexNames('post_shares'))->toContain('post_shares_post_id_index');
    expect($indexNames('post_media'))->toContain('post_media_post_id_index');
});
