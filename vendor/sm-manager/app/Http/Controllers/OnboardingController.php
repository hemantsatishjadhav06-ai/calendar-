<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use App\Enums\OnboardingStep;
use App\Models\User;
use App\Models\Workspace;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;

class OnboardingController extends Controller
{
    public function welcomed(Request $request): RedirectResponse
    {
        $workspace = $this->currentWorkspace($request);
        $workspace->forceFill(['onboarding_welcomed_at' => now()])->save();

        // The modal's primary CTA sends the user to connect an account. That
        // step is data-derived (done once an account exists), so nothing to
        // record here — just route there.
        if ($request->boolean('connect')) {
            return redirect()->route(OnboardingStep::ConnectAccount->routeName());
        }

        return back();
    }

    public function dismiss(Request $request): RedirectResponse
    {
        $workspace = $this->currentWorkspace($request);

        abort_unless($workspace->connectedAccounts()->exists(), 409);

        $workspace->forceFill(['onboarding_dismissed_at' => now()])->save();

        return back();
    }

    /**
     * Mark a click-to-complete checklist step done and redirect to where it
     * leads. Only steps without a data signal (timezone) use this path; the
     * rest derive their done-state and are plain navigation links.
     */
    public function completeStep(Request $request): RedirectResponse
    {
        $workspace = $this->currentWorkspace($request);

        $step = OnboardingStep::tryFrom((string) $request->input('key'));
        abort_if($step === null || ! $step->isClickToComplete(), 404);

        /** @var User $user */
        $user = $request->user();
        abort_unless($user->hasAllPermissions([$step->permission()], $workspace->id), 403);

        $this->recordStep($workspace, $step);

        return redirect()->route($step->routeName());
    }

    private function currentWorkspace(Request $request): Workspace
    {
        /** @var User $user */
        $user = $request->user();
        $workspace = $user->currentWorkspace;

        abort_unless(
            $workspace !== null && $user->isMemberOfWorkspace($workspace->id),
            403,
        );

        return $workspace;
    }

    private function recordStep(Workspace $workspace, OnboardingStep $step): void
    {
        /** @var list<string> $progress */
        $progress = $workspace->onboarding_progress ?? [];

        if (! in_array($step->value, $progress, true)) {
            $progress[] = $step->value;
            $workspace->forceFill(['onboarding_progress' => $progress])->save();
        }
    }
}
