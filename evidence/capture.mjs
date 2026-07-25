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
    // The follow-camera renders 1:1 and holds the LOCAL ship (slot 0) centred, so
    // the home planet is ~90 px off-centre and the seven others sit on a ring of
    // radius ~896 world-px around the arena centre, which is itself ~806 px from
    // the ship. To frame the whole ring in one shot the viewport must reach the
    // far-side planet at x-offset ≈ -1702 and the top/bottom at y-offset ≈ ±896
    // (planet radius 64): half-extents ≥ 1766 × 960 → 3600 × 2000. Big canvas,
    // static frozen scene, so it composites fine headless.
    device: { viewport: { width: 3600, height: 2000 }, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
    url: '/?debug=1&freeze=1',
    async run(page) {
      await settle(page, { frozen: true, ms: 2000 });
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
    id: 'turret-construction',
    device: DESKTOP,
    url: '/?debug=1',
    // The wheel opens at your own planet (docked at spawn). E is a rising-edge
    // TOGGLE (main.ts:434), and segment 0 — TURRET — sits at twelve o'clock
    // (wheel-input.ts `segmentIndexAt`). So: tap E to open, click straight above
    // centre to buy the turret (ORE 3 → 0), tap E again to CLOSE the wheel so the
    // planet is unobscured, then let the 10 s build (TURRET.buildTime) run partway
    // — the plasma construction arc grows around the home planet while it does.
    async run(page) {
      await settle(page, { ms: 2500 });
      const { width, height } = page.viewportSize();
      // HOLD E — a tapped key can fall entirely between two of this container's
      // slow per-tick input samples, so the wheel's rising-edge toggle never sees
      // it (a bare `press` left ORE untouched). A held-then-released key spans
      // several frames and toggles reliably.
      await page.keyboard.down('KeyE');
      await page.waitForTimeout(700); // wheel opens on the rising edge
      await page.keyboard.up('KeyE');
      await page.waitForTimeout(300);
      // TURRET wedge: twelve o'clock, between the hub (0.3 r) and the rim. The
      // press is an event-driven canvas pointerdown, so it lands regardless of fps.
      await page.mouse.click(width / 2, height / 2 - 140);
      await page.waitForTimeout(600); // order placed, ORE 3 → 0, build queued
      await page.keyboard.down('KeyE'); // toggle the wheel shut — reveal the planet
      await page.waitForTimeout(500);
      await page.keyboard.up('KeyE');
      await page.waitForTimeout(2500); // partway into the 10 s build: arc clearly mid
    },
  },
  {
    id: 'alarm-arrow',
    device: DESKTOP,
    url: '/?debug=1',
    // The under-attack alarm fires on SUSTAINED damage to your own planet, paired
    // with a screen-edge arrow pointing home (GDD §2.2, ui/alarm.ts) — the "deep
    // in the field and the alarm fires" moment. Offline the seven rivals are live
    // bots (match-boot.ts), and abandoning your home draws an adjacent bot onto
    // the undefended core within seconds. So: hold A to thrust toward the arena
    // centre (home recedes off the right edge, arming the arrow), then wait —
    // gated on the sim's own tick counter (window.__planetRush.ticks), not wall
    // time, so a slow-fps host just takes longer rather than missing the window.
    // A headless replay of this exact input (evidence/README notes the probe)
    // puts the alarm firing from ~tick 790 with the core alive past tick 2000;
    // tick 1200 sits squarely inside that siege, well before the core falls.
    async run(page) {
      await settle(page, { ms: 1500 });
      await page.keyboard.down('KeyA'); // thrust toward centre — leave home behind
      await page.waitForFunction(() => (window.__planetRush?.ticks ?? 0) >= 1200, undefined, {
        timeout: 180_000,
      });
      // Hold the thrust through the shutter so the ship is still off-home (the
      // arrow only draws while home is outside the viewport).
    },
  },

  // === Evidence round 2 — the five field-reported combat bugs (m2-10..13) =====
  // These four scenes drive a LIVE siege of the player's own home so the camera
  // (which hard-follows the local ship) can frame enemy fire, a defending turret,
  // and enemy hulls all at once — then LOOK for each fix on screen.

  {
    // A wide-viewport home siege used to inspect THREE gates in one frame:
    // enemy-beam-visible, turret-firing, enemy-healthbars. Build a turret at
    // spawn (docked), then fly out so the seven bots swarm the undefended core.
    // The 2400×1350 viewport is wide enough that the 1:1 follow-camera still
    // frames home (and the besieging bots + the turret) while the local ship is
    // off to the side.
    id: 'combat-siege',
    device: { viewport: { width: 1900, height: 1100 }, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
    url: '/?debug=1',
    async run(page) {
      await settle(page, { ms: 2000 });
      // Home ≈ the ship's spawn world position (it spawns docked at its planet).
      const home = await page.evaluate(() => ({
        x: window.__planetRush.shipWorld.x,
        y: window.__planetRush.shipWorld.y,
      }));
      // --- Build a turret at the home planet (segment 0, twelve o'clock). ---
      await page.keyboard.down('KeyE'); // hold — rising-edge toggle opens the wheel
      await page.waitForTimeout(700);
      await page.keyboard.up('KeyE');
      await page.waitForTimeout(300);
      // Click the TURRET wedge at the wheel's ACTUAL drawn geometry (read from
      // the ?debug=1 layout registry) so the tap lands where it is really drawn.
      const wheel = await page.evaluate(() => {
        const pr = window.__planetRush;
        const e = pr?.layout?.find((x) => x.id === 'build-wheel');
        return e ? e.bounds : null;
      });
      const { width, height } = page.viewportSize();
      if (wheel) {
        const cx = wheel.x + wheel.width / 2;
        const cy = wheel.y + wheel.height / 2;
        await page.mouse.click(cx, cy - (wheel.width / 2) * 0.6);
      } else {
        await page.mouse.click(width / 2, height / 2 - 140); // fallback: above centre
      }
      await page.waitForTimeout(500); // ORE 3 → 0, turret build queued (10 s)
      await page.keyboard.down('KeyE'); // toggle the wheel shut — unobscure the field
      await page.waitForTimeout(500);
      await page.keyboard.up('KeyE');
      // --- KITE a hunter home. Sitting at home is safe by design (a docked ship
      //     is "defended", low opportunity), so to draw a fight I must first get
      //     EXPOSED: fly out into the field until a bot locks on and gives chase,
      //     then run BACK to the home turret so the chaser follows into its 240u
      //     range. All three combat tells then sit in one framed shot: the turret
      //     firing at the bot, the bot firing back, and the bot's health bar. ---
      // Out ~620u (exposed), linger so a bot commits to the chase, then back home.
      await page.keyboard.down('KeyA');
      await page.waitForFunction(
        (h) => {
          const s = window.__planetRush.shipWorld;
          return (s.x - h.x) ** 2 + (s.y - h.y) ** 2 >= 620 * 620;
        },
        home,
        { timeout: 60_000 },
      );
      await page.keyboard.up('KeyA');
      await page.waitForTimeout(1800); // let a hunter lock on and close distance
      await page.keyboard.down('KeyD');
      await page.waitForFunction(
        (h) => {
          const s = window.__planetRush.shipWorld;
          return (s.x - h.x) ** 2 + (s.y - h.y) ** 2 <= 150 * 150;
        },
        home,
        { timeout: 60_000 },
      );
      await page.keyboard.up('KeyD');
      // Let the chasers close on the doorstep (into turret range), then OPEN FIRE
      // ourselves: KeyF switches to auto-aim so the local beam locks the nearest
      // bot without mouse tracking, and holding Left mouse fires it. This forces a
      // real exchange — our beam out, theirs (should be) back — and drags the bot
      // into the home turret's 240u range. The local beam is the one beam the
      // client is known to draw, so it is the control: whatever the enemy tell
      // does or does not do sits right beside a beam that definitely rendered.
      await page.waitForTimeout(1100);
      await page.keyboard.press('KeyF'); // Manual → AutoAim
      const { width: vw, height: vh } = page.viewportSize();
      await page.mouse.move(vw / 2 + 60, vh / 2); // cursor onto the canvas
      await page.mouse.down(); // hold Fire — auto-aim locks the nearest bot
      await page.waitForTimeout(450); // shoot the shutter early, before the melee
      const diag = await page.evaluate((h) => {
        const s = window.__planetRush.shipWorld;
        return {
          ticks: window.__planetRush.ticks,
          distFromHome: Math.round(Math.hypot(s.x - h.x, s.y - h.y)),
        };
      }, home);
      console.log('combat-siege diag:', JSON.stringify(diag));
    },
  },

  {
    // A GENUINE core siege, framed. Abandon home far enough (~900u) that a bot
    // commits to besieging the undefended core (stand-off ~175u from centre, well
    // inside the home turret's 240u reach), but keep home inside this very wide
    // follow-camera frame. On the tick a bot is beaming the core: the turret's
    // red projectiles fly at it (turret-firing), the bot's own beam should cut
    // the core (enemy-beam-visible), and the bot should carry a health bar
    // (enemy-healthbars). One frame, three gates.
    id: 'core-siege',
    device: { viewport: { width: 2600, height: 1400 }, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
    url: '/?debug=1',
    async run(page) {
      await settle(page, { ms: 2000 });
      const home = await page.evaluate(() => ({
        x: window.__planetRush.shipWorld.x,
        y: window.__planetRush.shipWorld.y,
      }));
      // Build a turret at home (segment 0, twelve o'clock).
      await page.keyboard.down('KeyE');
      await page.waitForTimeout(700);
      await page.keyboard.up('KeyE');
      await page.waitForTimeout(300);
      const wheel = await page.evaluate(() => {
        const e = window.__planetRush?.layout?.find((x) => x.id === 'build-wheel');
        return e ? e.bounds : null;
      });
      const { width, height } = page.viewportSize();
      if (wheel) {
        await page.mouse.click(wheel.x + wheel.width / 2, wheel.y + wheel.height / 2 - (wheel.width / 2) * 0.6);
      } else {
        await page.mouse.click(width / 2, height / 2 - 140);
      }
      await page.waitForTimeout(500);
      await page.keyboard.down('KeyE');
      await page.waitForTimeout(500);
      await page.keyboard.up('KeyE');
      // Abandon home to ~900u (kept in the wide frame) and hold — long enough for
      // a bot to notice the undefended core and lay siege inside turret range.
      await page.keyboard.down('KeyA');
      await page.waitForFunction(
        (h) => {
          const s = window.__planetRush.shipWorld;
          return (s.x - h.x) ** 2 + (s.y - h.y) ** 2 >= 950 * 950;
        },
        home,
        { timeout: 60_000 },
      );
      await page.keyboard.up('KeyA');
      const gate = Number(process.env.SIEGE_TICK ?? 1900);
      await page.waitForFunction((g) => (window.__planetRush?.ticks ?? 0) >= g, gate, {
        timeout: 180_000,
      });
      const diag = await page.evaluate((h) => {
        const s = window.__planetRush.shipWorld;
        return { ticks: window.__planetRush.ticks, distFromHome: Math.round(Math.hypot(s.x - h.x, s.y - h.y)) };
      }, home);
      console.log('core-siege diag:', JSON.stringify(diag));
    },
  },

  {
    // build-button-after-build — the touch BUILD button (GDD §2.4) must survive
    // a completed construction. Phone landscape (isTouch), open the wheel by
    // tapping BUILD, order a turret, let the 10 s (600-tick) build finish, then
    // shoot: the plasma BUILD button must still be on screen and hittable.
    id: 'build-button-after-build',
    device: PHONE_LANDSCAPE,
    url: '/?debug=1',
    async run(page) {
      await settle(page, { ms: 1500 });
      await page.waitForFunction(
        () => {
          const pr = window.__planetRush;
          return !!pr && Array.isArray(pr.layout) && pr.layout.length > 0 && (pr.ticks ?? 0) > 3;
        },
        undefined,
        { timeout: 20_000 },
      );
      // BUILD button centre (mirrors src/platform/touch-visuals.ts): above the
      // left thrust stick, in the left thumb's reach.
      const { width: w, height: h } = page.viewportSize();
      const EDGE_MARGIN = 28;
      const R_STICK = 64;
      const BUILD_GAP = 18;
      const R_BUILD = 38;
      const bx = EDGE_MARGIN + R_STICK;
      const by = h - EDGE_MARGIN - R_STICK - R_STICK - BUILD_GAP - R_BUILD;
      await page.touchscreen.tap(bx, by); // open the wheel
      await page.waitForTimeout(250);
      // Tap the TURRET wedge at the wheel's real drawn radius (registry).
      const wheel = await page.evaluate(() => {
        const pr = window.__planetRush;
        const e = pr?.layout?.find((x) => x.id === 'build-wheel');
        return e ? e.bounds : null;
      });
      if (wheel) {
        const cx = wheel.x + wheel.width / 2;
        const cy = wheel.y + wheel.height / 2;
        await page.touchscreen.tap(cx, cy - (wheel.width / 2) * 0.6);
      }
      await page.waitForTimeout(250);
      // Let the 600-tick build fully complete, then a little past it.
      await page.evaluate(
        () =>
          new Promise((resolve) => {
            const pr = window.__planetRush;
            const t0 = pr.ticks;
            const poll = () => {
              if (pr.ticks - t0 >= 660) resolve();
              else requestAnimationFrame(poll);
            };
            requestAnimationFrame(poll);
          }),
      );
      const during = await page.evaluate(() => {
        const ids = (window.__planetRush?.layout ?? []).map((e) => e.id);
        return { ticks: window.__planetRush?.ticks, buildButton: ids.includes('build-button'), buildWheel: ids.includes('build-wheel') };
      });
      console.log('build-button-after-build DURING (wheel still open, build done):', JSON.stringify(during));
      // Prove it is HITTABLE after the build: tap the BUILD button again — this
      // must CLOSE the wheel, leaving the standalone button on screen (the exact
      // thing the field report said vanished). Capture that resting frame.
      await page.touchscreen.tap(bx, by);
      await page.waitForTimeout(300);
      const after = await page.evaluate(() => {
        const ids = (window.__planetRush?.layout ?? []).map((e) => e.id);
        return { ticks: window.__planetRush?.ticks, buildButton: ids.includes('build-button'), buildWheel: ids.includes('build-wheel'), ids };
      });
      console.log('build-button-after-build AFTER (tapped to close):', JSON.stringify(after));
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
