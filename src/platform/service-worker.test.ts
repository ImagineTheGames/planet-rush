/**
 * src/platform/service-worker.test.ts — the four things a0-66 proved were not
 * true of the old registration: it happens on a plain page load, it happens even
 * when `load` has already fired, it asks for the URL the DEPLOY serves, and it
 * cannot take the boot down with it.
 */
import { describe, expect, it, vi } from 'vitest';
import { registerServiceWorker } from './service-worker';
import type { ServiceWorkerNavigator, ServiceWorkerWindow } from './service-worker';

/** A `window` whose readyState is `loading`, capturing its one `load` listener. */
function pendingWindow(): ServiceWorkerWindow & { fireLoad(): void } {
  let listener: (() => void) | null = null;
  return {
    document: { readyState: 'loading' },
    addEventListener: (_type, l) => {
      listener = l;
    },
    fireLoad: () => listener?.(),
  };
}

/** A `window` that has already finished loading — no listener will ever fire. */
function loadedWindow(): ServiceWorkerWindow {
  return {
    document: { readyState: 'complete' },
    addEventListener: () => {
      throw new Error('must not wait on a load event that has already fired');
    },
  };
}

/** A `navigator` with a worker container that records what it was asked for. */
function navWithWorker(result: Promise<unknown> = Promise.resolve({})): {
  nav: ServiceWorkerNavigator;
  register: ReturnType<typeof vi.fn>;
} {
  const register = vi.fn(() => result);
  return { nav: { serviceWorker: { register } }, register };
}

describe('registerServiceWorker', () => {
  it('registers on a plain page load, behind nothing the player has to do', async () => {
    const win = pendingWindow();
    const { nav, register } = navWithWorker();

    registerServiceWorker(win, nav, '/');
    expect(register, 'not before load — it must not race the first paint').not.toHaveBeenCalled();

    win.fireLoad();
    await Promise.resolve();
    expect(register).toHaveBeenCalledWith('/sw.js');
  });

  it('registers immediately when load has already fired', async () => {
    // The branch that matters in practice: `src/main.ts` is a dynamic import
    // awaited behind the font boot gate, so `boot()` frequently starts after the
    // load event. `loadedWindow()` throws if a listener is added at all.
    const { nav, register } = navWithWorker();
    registerServiceWorker(loadedWindow(), nav, '/');
    await Promise.resolve();
    expect(register).toHaveBeenCalledWith('/sw.js');
  });

  it('asks for the worker at the DEPLOY base, not the origin root', async () => {
    // `sw.js` is a `public/` file and moves with the base exactly like the fonts
    // that 404'd in a0-66. A worker fetched from the origin root would also fail
    // the scope check, so this is two bugs in one spelling.
    const { nav, register } = navWithWorker();
    registerServiceWorker(loadedWindow(), nav, '/planet-rush/');
    await Promise.resolve();
    expect(register).toHaveBeenCalledWith('/planet-rush/sw.js');
  });

  it('resolves a relative base document-relatively, and tolerates a missing slash', async () => {
    const a = navWithWorker();
    registerServiceWorker(loadedWindow(), a.nav, './');
    const b = navWithWorker();
    registerServiceWorker(loadedWindow(), b.nav, '/planet-rush');
    await Promise.resolve();
    expect(a.register).toHaveBeenCalledWith('./sw.js');
    expect(b.register).toHaveBeenCalledWith('/planet-rush/sw.js');
  });

  it('is a no-op where the browser has no worker support', () => {
    // Non-secure origin, older iOS Safari in a private window: a supported way to
    // play (§4.9). Reading `.register` off `undefined` would throw inside boot().
    expect(() => registerServiceWorker(loadedWindow(), {}, '/')).not.toThrow();
  });

  it('swallows a rejected registration rather than taking the boot down', async () => {
    const { nav } = navWithWorker(Promise.reject(new Error('SecurityError')));
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      expect(() => registerServiceWorker(loadedWindow(), nav, '/')).not.toThrow();
      await new Promise((r) => setTimeout(r, 0));
      expect(unhandled, 'a failed install is never an unhandled rejection').not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });

  it('swallows a register() that throws synchronously', () => {
    const nav: ServiceWorkerNavigator = {
      serviceWorker: {
        register: () => {
          throw new Error('blocked by policy');
        },
      },
    };
    expect(() => registerServiceWorker(loadedWindow(), nav, '/')).not.toThrow();
  });
});
