import confetti, { type Options } from 'canvas-confetti';

/** Brand-green-forward palette with white + gold sparkle for contrast. */
const COLORS = [
    '#65a30d',
    '#84cc16',
    '#22c55e',
    '#10b981',
    '#ffffff',
    '#fde047',
];

/**
 * Fire a short, layered confetti burst to celebrate a post going out (publish,
 * schedule, or queue). Fire-and-forget: canvas-confetti manages its own
 * fullscreen canvas on `<body>`, so the burst survives the Inertia visit that
 * follows a successful submit. Honors `prefers-reduced-motion`.
 */
export function celebrate(): void {
    const defaults: Options = {
        origin: { y: 0.7 },
        colors: COLORS,
        disableForReducedMotion: true,
        zIndex: 100,
    };

    function burst(particleRatio: number, opts: Options) {
        void confetti({
            ...defaults,
            ...opts,
            particleCount: Math.floor(180 * particleRatio),
        });
    }

    // Layered bursts (canvas-confetti's "realistic" recipe) read richer than a
    // single pop: a tight fast core, a wide spray, and a couple of slow drifters.
    burst(0.25, { spread: 26, startVelocity: 55 });
    burst(0.2, { spread: 60 });
    burst(0.35, { spread: 100, decay: 0.91, scalar: 0.8 });
    burst(0.1, { spread: 120, startVelocity: 25, decay: 0.92, scalar: 1.2 });
    burst(0.1, { spread: 120, startVelocity: 45 });
}
