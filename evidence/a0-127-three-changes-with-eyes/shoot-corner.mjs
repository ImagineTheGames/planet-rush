/**
 * evidence/a0-127-three-changes-with-eyes/shoot-corner.mjs — a0-125 D1 on the
 * SHIPPING BUILD: the own-station HP readout with the re-enter-fullscreen
 * affordance up. OWNER: QA Manager (a0-127).
 *
 * a0-122 measured `fullscreen-reenter ∩ station-hp` at 31% of the readout on 462
 * phone frames; a0-125 fixed it by standing the top-right column off the glass
 * corner by whatever the button takes of it, and photographed the fix on a BENCH
 * (`evidence/a0-125-the-corner-two-boxes-share`, `new Hud(...)` +
 * `new FullscreenAffordance()` on a Pixi app). Its README says why: *"a headless
 * screenshot run never leaves fullscreen, so the button is never drawn."*
 *
 * This is that claim on the real client. The affordance is up only when the game
 * is on a touch device that CAN go fullscreen, HAS been fullscreen, and is not
 * fullscreen now (`FullscreenLifecycle.affordanceVisible`). Headless Chromium
 * grants no element fullscreen, so the only thing stubbed here is the BROWSER's
 * Fullscreen API — the same stub `tests/live-stage/fullscreen.spec.ts` installs,
 * verbatim in shape: a request makes its element `document.fullscreenElement` and
 * fires `fullscreenchange`; `exitFullscreen` clears it and fires it too.
 *
 * Nothing about the game is stubbed. Every pixel below is the production bundle
 * drawing its own HUD and its own button, on the real match, reached through the
 * front door with real taps: PLAY (which is the gesture that requests fullscreen)
 * → PLAY SOLO → RUSH!, then the player backs out of fullscreen the way the field
 * request describes, and the button appears.
 *
 * Two frames per run: `before-exit` (fullscreen, no button) and `after-exit` (the
 * button up), plus a 4× crop of the corner, cut from the BUTTON's rect — never
 * from the readout's, because the readout is the thing that moves (a0-125's rule,
 * kept so the pair reads as one comparison).
 */
import { chromium } from 'playwright';
import { PHONE, bootMenu, crop, elements, frame, note, overlap, pageOptions, park, rectOf, settle, shotPath, stamp, writeCrop } from './lib.mjs';

const browser = await chromium.launch();
const page = await browser.newPage(pageOptions(PHONE));
page.on('pageerror', (e) => console.log('  [pageerror]', e.message));

// The browser's Fullscreen API, working and controllable. Installed before any
// page script runs. This is the ONLY stub in this capture.
await page.addInitScript(() => {
  const holder = { current: null };
  Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, get: () => true });
  Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => holder.current });
  Element.prototype.requestFullscreen = function () {
    holder.current = this;
    document.dispatchEvent(new Event('fullscreenchange'));
    return Promise.resolve();
  };
  document.exitFullscreen = function () {
    holder.current = null;
    document.dispatchEvent(new Event('fullscreenchange'));
    return Promise.resolve();
  };
});

const press = async (p) => {
  await page.touchscreen.tap(p.x, p.y);
  await settle(page, 12);
};

await bootMenu(page);
await press(await page.evaluate(() => ({ ...window.__mainMenu.controls.find((c) => c.kind === 'play').physicalCenter })));
await press(await page.evaluate(() => ({ ...window.__onlineMenu.doorControls.find((c) => c.kind === 'solo').physicalCenter })));
await page.waitForFunction(() => typeof window.__lobby?.rush === 'function', undefined, { timeout: 30_000 });
await press(await page.evaluate(() => ({ ...window.__lobby.rushControl.physicalCenter })));
await page.waitForFunction(() => window.__mainMenu?.matchStarted === true, undefined, { timeout: 60_000 });
await page.waitForFunction(() => '__fullscreen' in window, undefined, { timeout: 30_000 });
await page.waitForFunction(() => window.__fullscreen?.everEntered === true, undefined, { timeout: 30_000 });
await settle(page, 20);
await park(page);

const shot = async (tag) => {
  const name = `corner-d1-${tag}`;
  await frame(page, name);
  const els = await elements(page);
  const button = rectOf(els, 'fullscreen-reenter');
  const readout = rectOf(els, 'station-hp');
  const zoom = rectOf(els, 'zoom-control');
  const row = {
    tag,
    stamp: await stamp(page),
    fullscreen: await page.evaluate(() => ({
      active: window.__fullscreen.active,
      everEntered: window.__fullscreen.everEntered,
      affordanceVisible: window.__fullscreen.affordanceVisible,
      bounds: window.__fullscreen.bounds,
      withinAnchor: window.__fullscreen.withinAnchor,
    })),
    button,
    readout,
    zoom,
    cover: overlap(button, readout),
    coverShare: (() => {
      const o = overlap(button, readout);
      return o && readout ? +((o.width * o.height) / (readout.width * readout.height)).toFixed(3) : 0;
    })(),
    air: button && readout ? +(button.x - (readout.x + readout.width)).toFixed(1) : null,
    ids: els.map((e) => e.id),
  };
  console.log(`${tag}: affordance=${row.fullscreen.affordanceVisible} button=${JSON.stringify(button)} station-hp=${JSON.stringify(readout)} cover=${(row.coverShare * 100).toFixed(0)}% air=${row.air}`);
  // The corner, 4×, anchored on the BUTTON's own rect (a0-125's rule) so both
  // frames crop the identical region of the screen.
  const anchor = button ?? { x: 738, y: 12, width: 48, height: 48 };
  const left = anchor.x - 190;
  writeCrop(
    `${name}-corner-4x`,
    crop(shotPath(name), {
      x: Math.round(left * PHONE.dpr),
      y: 0,
      w: Math.round((anchor.x + anchor.width - left + 4) * PHONE.dpr),
      h: Math.round((anchor.y + anchor.height + 22) * PHONE.dpr),
      scale: 4,
    }),
  );
  return row;
};

const readback = [];
readback.push(await shot('before-exit'));
// The player backs out of fullscreen — a system gesture / ESC, the exact thing the
// field request says must never strand the game.
await page.evaluate(() => document.exitFullscreen());
await page.waitForFunction(() => window.__fullscreen?.affordanceVisible === true, undefined, { timeout: 30_000 });
await settle(page, 20);
await park(page);
readback.push(await shot('after-exit'));

note('corner-d1-readback', readback);
await browser.close();
