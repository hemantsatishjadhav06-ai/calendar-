export type OnboardingStep = {
    key: string;
    label: string;
    done: boolean;
    href: string;
    // Timezone has no data signal, so it completes on click; the rest derive
    // done-state and are plain navigation links.
    clickToComplete: boolean;
};

export type OnboardingData = {
    welcomed: boolean;
    dismissed: boolean;
    complete: boolean;
    steps: OnboardingStep[];
};
