/**
 * src/main.ts — client bootstrap. OWNER: Platform Engineer.
 *
 * Wires the platform seam, input mapping, game loop, and render layer together.
 * Day-0 scaffold: this only proves the PixiJS stack is wired and the app shell
 * mounts. No game logic yet — the ship starts flying in the day-1 milestone.
 */
import { Application } from 'pixi.js';
import { FIXED_DT } from '@platform/loop';

async function boot(): Promise<void> {
  const app = new Application();
  await app.init({
    background: 0x0d1015, // Cold Vacuum background (GDD §5.1)
    resizeTo: window,
    antialias: true,
    // Respect device pixel ratio for crisp rendering on mobile (amendment §1).
    resolution: window.devicePixelRatio || 1,
    autoDensity: true,
  });

  const mount = document.getElementById('app');
  if (mount) mount.appendChild(app.canvas);

  // Sim tick is fixed at FIXED_DT (60 Hz); render is decoupled (GDD §4.1).
  void FIXED_DT;

  // Register the service worker (PWA app-shell caching, GDD §4.1). Optional and
  // best-effort — mobile-browser play survives without it (§4.9).
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {
      /* offline install is a nice-to-have; never block boot on it */
    });
  }
}

void boot();
