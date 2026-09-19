<?php

declare(strict_types=1);

namespace App\Concerns;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\Context;

// @phpstan-ignore trait.unused (consumed by future workspace-owned models; exercised via tests/Feature/Workspace/HasWorkspaceScopeTest.php in the meantime)
trait HasWorkspaceScope
{
    public static function bootHasWorkspaceScope(): void
    {
        static::addGlobalScope('workspace', function (Builder $builder): void {
            if ($workspaceId = Context::get('workspace_id')) {
                $builder->where($builder->getModel()->getTable().'.workspace_id', $workspaceId);
            }
        });

        static::creating(function (Model $model): void {
            if (! $model->getAttribute('workspace_id') && ($workspaceId = Context::get('workspace_id'))) {
                $model->setAttribute('workspace_id', $workspaceId);
            }
        });
    }
}
