/**
 * PWA install-prompt tests (GDD §4.1 installability, §4.9 cuttable). The
 * controller must capture and defer `beforeinstallprompt` (suppressing the
 * browser's own infobar), expose installability, fire the native prompt once
 * from a gesture, and retire the offer on `appinstalled` — degrading to
 * `unavailable` on any browser that never fires the event.
 */
import { describe, it, expect, vi } from 'vitest';
import { InstallPromptController } from './install-prompt';
import type { BeforeInstallPromptEvent, InstallEventTarget } from './install-prompt';

/** A fake event target that records listeners and dispatches to them. */
function fakeTarget(): InstallEventTarget & { dispatch(type: string, e: Event): void } {
  const listeners = new Map<string, Set<(e: Event) => void>>();
  return {
    addEventListener(type, cb) {
      (listeners.get(type) ?? listeners.set(type, new Set()).get(type)!).add(cb);
    },
    removeEventListener(type, cb) {
      listeners.get(type)?.delete(cb);
    },
    dispatch(type, e) {
      for (const cb of listeners.get(type) ?? []) cb(e);
    },
  };
}

/** A fake `beforeinstallprompt` event with a spy-able prompt + a chosen outcome. */
function fakePromptEvent(outcome: 'accepted' | 'dismissed' = 'accepted'): BeforeInstallPromptEvent {
  return {
    preventDefault: vi.fn(),
    prompt: vi.fn().mockResolvedValue(undefined),
    userChoice: Promise.resolve({ outcome, platform: 'web' }),
  } as unknown as BeforeInstallPromptEvent;
}

describe('InstallPromptController', () => {
  it('is not installable before the browser offers a prompt', () => {
    const c = new InstallPromptController(fakeTarget());
    expect(c.canInstall).toBe(false);
    expect(c.isInstalled).toBe(false);
  });

  it('captures and defers beforeinstallprompt (suppresses the infobar)', () => {
    const t = fakeTarget();
    const onChange = vi.fn();
    const c = new InstallPromptController(t, onChange);
    const evt = fakePromptEvent();

    t.dispatch('beforeinstallprompt', evt as unknown as Event);

    expect(evt.preventDefault).toHaveBeenCalledOnce();
    expect(c.canInstall).toBe(true);
    expect(onChange).toHaveBeenCalledOnce();
  });

  it('fires the native prompt once and returns the user choice', async () => {
    const t = fakeTarget();
    const c = new InstallPromptController(t);
    const evt = fakePromptEvent('accepted');
    t.dispatch('beforeinstallprompt', evt as unknown as Event);

    expect(await c.prompt()).toBe('accepted');
    expect(evt.prompt).toHaveBeenCalledOnce();
    // Single-use: the deferred prompt is spent, so no second offer.
    expect(c.canInstall).toBe(false);
    expect(await c.prompt()).toBe('unavailable');
  });

  it('reports a dismissed choice through', async () => {
    const t = fakeTarget();
    const c = new InstallPromptController(t);
    t.dispatch('beforeinstallprompt', fakePromptEvent('dismissed') as unknown as Event);
    expect(await c.prompt()).toBe('dismissed');
  });

  it('returns unavailable when no prompt was ever captured', async () => {
    const c = new InstallPromptController(fakeTarget());
    expect(await c.prompt()).toBe('unavailable');
  });

  it('retires the offer and marks installed on appinstalled', () => {
    const t = fakeTarget();
    const c = new InstallPromptController(t);
    t.dispatch('beforeinstallprompt', fakePromptEvent() as unknown as Event);
    expect(c.canInstall).toBe(true);

    t.dispatch('appinstalled', {} as Event);
    expect(c.isInstalled).toBe(true);
    expect(c.canInstall).toBe(false);
  });

  it('never throws when the native prompt rejects (degrades to unavailable)', async () => {
    const t = fakeTarget();
    const c = new InstallPromptController(t);
    const evt = {
      preventDefault: vi.fn(),
      prompt: vi.fn().mockRejectedValue(new Error('needs a user gesture')),
      userChoice: Promise.resolve({ outcome: 'accepted', platform: 'web' }),
    } as unknown as BeforeInstallPromptEvent;
    t.dispatch('beforeinstallprompt', evt as unknown as Event);

    await expect(c.prompt()).resolves.toBe('unavailable');
  });

  it('detaches listeners on dispose', () => {
    const t = fakeTarget();
    const c = new InstallPromptController(t);
    c.dispose();
    // After dispose a fired event is ignored.
    t.dispatch('beforeinstallprompt', fakePromptEvent() as unknown as Event);
    expect(c.canInstall).toBe(false);
  });
});
