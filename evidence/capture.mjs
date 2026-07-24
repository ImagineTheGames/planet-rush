/**
 * evidence/capture.mjs — the evidence camera. OWNER: QA Manager.
 *
 * Drives the REAL preview build (npm run build && vite preview on :4173) with a
 * headless Chromium and writes one PNG per scene into evidence/images/. It
 * asserts nothing: every claim about a shot lives in evidence/manifest.json,
 * written by a human-equivalent LOOK at the image afterwards. This file only
 * guarantees WHAT WAS ON SCREEN when the shutter fired — device profile, URL,
 * settle conditions and any input driven before the capture.
 *
 * Usage:  node evidence/capture.mjs [shot-id ...]     (no args = all shots)
 */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'images');
const BASE = process.env.EVIDENCE_BASE_URL ?? 'http://localhost:4173';

/** Device profiles mirror playwright.config.ts's matrix — the same contract the
 *  mobile suite emulates against, so a shot and a test describe one device. */
const DESKTOP = { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, isMobile: false, hasTouch: false };
const PHONE_LANDSCAPE = { viewport: { width: 844, height: 390 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true };
const PHONE_PORTRAIT = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true };

/** Wait until the canvas is attached and a few frames have composited. Frozen
 *  builds additionally wait for the debug hook to report `frozen`. */
async function settle(page, { frozen = false, ms = 1200 } = {}) {
  await page.waitForSelector('canvas', { state: 'attached', timeout: 30_000 });
  if (frozen) {
    await page.waitForFunction(
      () => {
        const pr = window.__planetRush;
        const f = pr?.layout?.frozen ?? pr?.frozen;
        return typeof f === 'function' ? f() === true : f === true;
      },
      undefined,
      { timeout: 20_000 },
    );
  }
  await page.evaluate(() => document.fonts?.ready);
  await page.waitForTimeout(ms);
}

const SHOTS = [
  {
    id: 'boot-desktop',
    device: DESKTOP,
    url: '/',
    async run(page) {
      await settle(page);
    },
  },
  {
    id: 'boot-phone-landscape',
    device: PHONE_LANDSCAPE,
    url: '/',
    async run(page) {
      await settle(page);
    },
  },
  {
    id: 'hud-desktop',
    device: DESKTOP,
    url: '/',
    // Live (not frozen) and held for several seconds so the wave clock is
    // visibly counting rather than pinned — the HUD shot must prove a running
    // clock, not a still one.
    async run(page) {
      await settle(page, { ms: 6000 });
    },
  },
  {
    id: 'hud-detail-ore-wave',
    device: { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2, isMobile: false, hasTouch: false },
    url: '/',
    clip: { x: 0, y: 0, width: 900, height: 90 },
    // A 2× close-up of the top band so the ore readout and the wave clock can be
    // read rather than guessed at from a 1× thumbnail.
    async run(page) {
      await settle(page, { ms: 4000 });
    },
  },
  {
    id: 'hud-detail-controls-strip',
    device: { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2, isMobile: false, hasTouch: false },
    url: '/',
    clip: { x: 0, y: 745, width: 900, height: 55 },
    async run(page) {
      await settle(page, { ms: 4000 });
    },
  },
  {
    id: 'touch-affordances-phone',
    device: PHONE_LANDSCAPE,
    url: '/',
    // Idle affordances only: no touch is held, so what is on screen is whatever
    // the build draws UNPROMPTED — the exact thing the M1 phone report caught
    // missing.
    async run(page) {
      await settle(page, { ms: 2000 });
    },
  },
  {
    id: 'touch-stick-engaged-phone',
    device: PHONE_LANDSCAPE,
    url: '/',
    // Left thumb down and dragged, held at capture: the dynamic stick should be
    // under the thumb while the touch is live.
    async run(page) {
      await settle(page, { ms: 1500 });
      await page.touchscreen.tap(200, 300); // wake the touch layer
      const canvas = await page.$('canvas');
      const box = await canvas.boundingBox();
      const x = box.x + 150;
      const y = box.y + box.height * 0.6;
      await page.mouse.move(x, y);
      await page.evaluate(
        ([px, py]) => {
          const c = document.querySelector('canvas');
          const opts = { bubbles: true, cancelable: true, pointerId: 1, pointerType: 'touch', isPrimary: true };
          c.dispatchEvent(new PointerEvent('pointerdown', { ...opts, clientX: px, clientY: py }));
          c.dispatchEvent(new PointerEvent('pointermove', { ...opts, clientX: px + 40, clientY: py - 30 }));
        },
        [x, y],
      );
      await page.waitForTimeout(600);
    },
  },
  {
    id: 'rotate-overlay-portrait',
    device: PHONE_PORTRAIT,
    url: '/',
    async run(page) {
      await settle(page, { ms: 2000 });
    },
  },
  {
    id: 'rotate-overlay-portrait-ios',
    device: PHONE_PORTRAIT,
    url: '/',
    // The ROTATE overlay is specified to appear only where orientation LOCK is
    // unsupported — iOS Safari (orientation.ts `shouldShowRotateOverlay`). A
    // stock headless Chromium *can* lock, so it takes the lock path and the
    // overlay legitimately never shows there. This shot removes
    // `screen.orientation.lock` before the app boots, emulating the iOS Safari
    // capability profile, so the fallback path can be photographed at all. The
    // capability stub is the ONLY difference from the shot above.
    async run(page) {
      await settle(page, { ms: 2000 });
    },
    async init(page) {
      await page.addInitScript(() => {
        try {
          delete Object.getPrototypeOf(screen.orientation).lock;
        } catch {
          /* fall through to the own-property delete below */
        }
        try {
          Object.defineProperty(screen.orientation, 'lock', { value: undefined, configurable: true });
        } catch {
          /* best effort — the shot records whatever the page actually did */
        }
      });
    },
  },
  {
    id: 'golden-frozen-desktop',
    device: DESKTOP,
    url: '/?debug=1&freeze=1',
    async run(page) {
      await settle(page, { frozen: true, ms: 1200 });
    },
  },
  {
    id: 'golden-frozen-phone-landscape',
    device: PHONE_LANDSCAPE,
    url: '/?debug=1&freeze=1',
    async run(page) {
      await settle(page, { frozen: true, ms: 1200 });
    },
  },
  {
    id: 'planet-ring',
    device: { viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
    url: '/?debug=1&freeze=1',
    // The widest frame we can ask for, on the deterministic seeded world whose
    // roster is a full 8-planet ring (freeze.ts FREEZE_PLAYER_COUNT = 8). If the
    // ring is drawn at all, this is the frame with the best chance of showing it.
    async run(page) {
      await settle(page, { frozen: true, ms: 1500 });
    },
  },
  {
    id: 'build-wheel-open',
    device: DESKTOP,
    url: '/?debug=1',
    // The controls strip on screen advertises "E  Build & Upgrade". Hold E at
    // the ship's spawn — which is its own planet, i.e. docked, the one place the
    // wheel is specified to open (GDD §2.5) — and photograph the result.
    async run(page) {
      await settle(page, { ms: 2500 });
      await page.keyboard.down('KeyE');
      await page.waitForTimeout(1500);
    },
  },
  {
    id: 'turret-under-construction',
    device: DESKTOP,
    url: '/?debug=1',
    // Hold E to request the wheel, then drive the confirm gestures a turret
    // order would need (click the wheel area / press the confirm keys) and let
    // the sim run long enough for a build to be visibly in progress.
    async run(page) {
      await settle(page, { ms: 2500 });
      await page.keyboard.down('KeyE');
      await page.waitForTimeout(800);
      const { width, height } = page.viewportSize();
      // Sweep the ring where wheel segments would sit, clicking each.
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        await page.mouse.click(width / 2 + Math.cos(a) * 160, height / 2 + Math.sin(a) * 160);
        await page.waitForTimeout(120);
      }
      await page.keyboard.press('Enter');
      await page.keyboard.up('KeyE');
      await page.waitForTimeout(4000); // let any queued build progress
    },
  },
  {
    id: 'alarm-arrow',
    device: DESKTOP,
    url: '/?debug=1',
    // The under-attack alarm is a sustained-damage trigger on your own planet
    // (GDD §2.2). Offline there is no attacker, so this shot documents the
    // longest unattended run we can give it — if the alarm frame/arrow can
    // appear in the shipped client at all, a two-minute idle match on the
    // seeded 8-player ring is where.
    async run(page) {
      await settle(page, { ms: 120_000 });
    },
  },
];

async function main() {
  mkdirSync(OUT, { recursive: true });
  const only = process.argv.slice(2);
  const shots = only.length ? SHOTS.filter((s) => only.includes(s.id)) : SHOTS;
  if (!shots.length) throw new Error(`no shots matched: ${only.join(', ')}`);

  const browser = await chromium.launch();
  try {
    for (const shot of shots) {
      const context = await browser.newContext(shot.device);
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(String(e)));
      page.on('console', (m) => {
        if (m.type() === 'error') errors.push(m.text());
      });
      if (shot.init) await shot.init(page);
      await page.goto(BASE + shot.url, { waitUntil: 'load' });
      await shot.run(page);
      const file = join(OUT, `${shot.id}.png`);
      await page.screenshot({ path: file, ...(shot.clip ? { clip: shot.clip } : {}) });
      const build = await page.evaluate(() => window.__planetRush?.build ?? null);
      console.log(
        JSON.stringify({ id: shot.id, url: shot.url, viewport: shot.device.viewport, build, errors }),
      );
      await context.close();
    }
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
