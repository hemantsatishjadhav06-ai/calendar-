import { describe, expect, it } from 'vitest';

import {
    commandShortcutListenerOptions,
    composeButtonClassName,
    composeIconClassName,
    isComposeShortcut,
} from '../compose-nav';

describe('isComposeShortcut', () => {
    it('matches plain command or control period only', () => {
        expect(
            isComposeShortcut({
                altKey: false,
                ctrlKey: false,
                key: '.',
                metaKey: true,
                shiftKey: false,
            }),
        ).toBe(true);
        expect(
            isComposeShortcut({
                altKey: false,
                ctrlKey: true,
                key: '.',
                metaKey: false,
                shiftKey: false,
            }),
        ).toBe(true);
        expect(
            isComposeShortcut({
                altKey: false,
                ctrlKey: false,
                key: 'k',
                metaKey: true,
                shiftKey: false,
            }),
        ).toBe(false);
        expect(
            isComposeShortcut({
                altKey: false,
                ctrlKey: false,
                key: '.',
                metaKey: true,
                shiftKey: true,
            }),
        ).toBe(false);
    });
});

describe('compose navigation classes', () => {
    it('keeps collapsed compose centered and removes nested icon backgrounds', () => {
        expect(composeButtonClassName(true)).toContain('justify-center');
        expect(composeButtonClassName(false)).not.toContain('justify-center');
        expect(composeIconClassName()).toContain('pointer-events-none');
        expect(composeIconClassName()).not.toContain('bg-');
        expect(composeIconClassName()).not.toContain('rounded');
    });
});

describe('command shortcut listener options', () => {
    it('listens in capture phase so browser chrome shortcuts are intercepted early', () => {
        expect(commandShortcutListenerOptions).toEqual({ capture: true });
    });
});
