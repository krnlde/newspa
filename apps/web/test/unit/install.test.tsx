import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useInstallPrompt } from '../../src/install.ts';
import { IOS_USER_AGENT, patchNavigator, restoreNavigator } from './support/navigator.ts';

/**
 * The install control's state (WP16, D-039): three modes, and the rule that
 * decides them is what this file pins.
 *
 * The mode is decided by what **this browser** offers, so each arm changes the
 * browser: the event Chromium fires, the flag iOS sets, the media query an
 * installed app answers. A test that only ever sees one of them cannot tell a
 * control that works from a control that is printed and dead.
 *
 * `navigator` is patched through `support/navigator.ts` and put back after every
 * arm. Measured the hard way: the arm that sets `standalone` leaked it into the two
 * arms after it, which then started 'installed' and failed on assertions that read
 * as if the hook ignored its own event.
 */

interface PromptEvent extends Event {
  prompt: () => Promise<void>;
}

const promptEvent = (): PromptEvent => {
  const event = new Event('beforeinstallprompt', { cancelable: true }) as PromptEvent;
  event.prompt = vi.fn(async (): Promise<void> => undefined);
  return event;
};

const fire = (event: Event): void => {
  act(() => {
    window.dispatchEvent(event);
  });
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  restoreNavigator();
});

describe('the install control', () => {
  it('is silent on a browser with no prompt, because an invented affordance is a lie', () => {
    const { result } = renderHook(() => useInstallPrompt());
    expect(result.current.mode).toBe('none');
  });

  it('prints a control once the browser hands over its prompt, and keeps the event', () => {
    const { result } = renderHook(() => useInstallPrompt());
    const event = promptEvent();
    fire(event);
    expect(result.current.mode).toBe('prompt');
    // The event is one-shot and the listener runs in the capture of the browser's
    // own dispatch: `preventDefault` is what keeps it for the reader's press.
    expect(event.defaultPrevented).toBe(true);
  });

  it('asks the browser once, and retires: a spent event is not a control', () => {
    const { result } = renderHook(() => useInstallPrompt());
    const event = promptEvent();
    fire(event);
    act(() => result.current.ask());
    expect(event.prompt).toHaveBeenCalledOnce();
    expect(result.current.mode).toBe('none');
    act(() => result.current.ask());
    expect(event.prompt).toHaveBeenCalledOnce();
  });

  it('names the recipe where the browser has no event, which is iOS (D-039)', () => {
    patchNavigator('userAgent', IOS_USER_AGENT);
    const { result } = renderHook(() => useInstallPrompt());
    expect(result.current.mode).toBe('recipe');
  });

  it('prints nothing when the app is installed already, prompt event or not', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query === '(display-mode: standalone)', media: query }));
    const { result } = renderHook(() => useInstallPrompt());
    fire(promptEvent());
    expect(result.current.mode).toBe('none');
  });

  it('reads the installed flag iOS sets, not only a media query', () => {
    // A phone that has the paper on its home screen answers `navigator.standalone`,
    // and that is the arm the media query can miss.
    patchNavigator('standalone', true);
    const { result } = renderHook(() => useInstallPrompt());
    expect(result.current.mode).toBe('none');
  });

  it('does nothing when asked with no event in hand, and says nothing about it', () => {
    const { result } = renderHook(() => useInstallPrompt());
    expect(result.current.mode).toBe('none');
    act(() => result.current.ask());
    expect(result.current.mode).toBe('none');
  });

  it('goes away when the browser reports the install happened by its own menu', () => {
    const { result } = renderHook(() => useInstallPrompt());
    const event = promptEvent();
    fire(event);
    expect(result.current.mode).toBe('prompt');
    fire(new Event('appinstalled'));
    expect(result.current.mode).toBe('none');
  });

  it('reports a refused prompt in the console, and leaves the page alone', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { result } = renderHook(() => useInstallPrompt());
    const event = new Event('beforeinstallprompt', { cancelable: true }) as PromptEvent;
    event.prompt = vi.fn(async (): Promise<void> => {
      throw new Error('the browser said no');
    });
    fire(event);
    // The refusal arrives on a microtask, after `prompt()` rejects, so the press is
    // awaited: asserting the console synchronously reads a warning that has not run.
    await act(async () => {
      result.current.ask();
    });
    expect(result.current.mode).toBe('none');
    expect(warn.mock.calls.map((call) => String(call[0])).join()).toContain('the browser said no');
  });
});
