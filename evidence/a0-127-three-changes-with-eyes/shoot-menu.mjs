/**
 * evidence/a0-127-three-changes-with-eyes/shoot-menu.mjs — the menu backdrop, on
 * the shipping bundle and on the one before a0-123. OWNER: QA Manager (a0-127).
 *
 * The developer reported this off the MENU — *"we have too many stars with bloom,
 * can we reduce the number, and also make it so not all of them have that cross"*
 * — so the specimen is the menu the front door opens onto (`?gate=0`), not a
 * review panel and not a rasterised plate. `src/ui/menu-backdrop.ts` drives the
 * game's one star field (`VoidBackdrop`) at the viewport with camera offset (0,0)
 * and bakes it once per resize, so the frame is a still and the field is a pure
 * function of `VOID_SEED` — the same sky on every boot and both builds.
 *
 * It writes, per build and per profile, the full frame plus the rectangles of the
 * menu's own INK — the four plates, the header, the footer — so `candidates.mjs`
 * can paint them out and the counting happens on SKY. A 2560×1600 frame shrunk to
 * fit a reader is a frame whose small orbs have been averaged away, so the
 * counting itself is done on `sky-tiles.mjs`'s native-size tiles: 1 image pixel =
 * 1 device pixel of the profile.
 *
 *   PREVIEW_PORT=4327 node evidence/a0-127-three-changes-with-eyes/shoot-menu.mjs after
 *   BEFORE_PORT=4328 node evidence/a0-127-three-changes-with-eyes/shoot-menu.mjs before
 */
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { BASE, BEFORE_BASE, DESKTOP, PHONE, SHOTS, bootMenu, frame, note, pageOptions, park, shotPath, stamp } from './lib.mjs';

const TAG = process.argv[2] ?? 'after';
const base = TAG === 'before' ? BEFORE_BASE : BASE;

const browser = await chromium.launch();
const readback = { tag: TAG, base, frames: [] };

for (const profile of [DESKTOP, PHONE]) {
  const page = await browser.newPage(pageOptions(profile));
  page.on('pageerror', (e) => console.log('  [pageerror]', e.message));
  await bootMenu(page, base);
  await park(page);
  const name = `${TAG}-menu-${profile.id}`;
  await frame(page, name);
  // The menu's own INK, so the counting can be done on the SKY and not on the
  // wordmark. The four plates are the client's own reported bounds; the header
  // and footer bands are two rectangles measured off this frame by eye (the
  // eyebrow + wordmark above the top rule, the bottom rule + build stamp below),
  // stated here so the mask is reproducible and identical on both builds.
  const plates = await page.evaluate(() =>
    (window.__mainMenu?.controls ?? []).map((c) => (c.physicalBounds ? { ...c.physicalBounds } : null)).filter(Boolean),
  );
  const dpr = profile.dpr;
  // The menu reports only a CENTRE per control, not a rect, so the plate band is
  // measured off this frame instead: the longest run of pixels above L=55 on each
  // row (the plates are the only large flat bright areas on the screen) gives
  // desktop plates x480..2060 y459..1160 and phone plates x293..1277 y128..655.
  // Rounded outward, and identical on both builds, so the two counts are taken
  // through the same window.
  const band = profile === DESKTOP
    ? { x: 466, y: 445, width: 1608, height: 730 }
    : { x: 281, y: 116, width: 1008, height: 552 };
  const ink = [
    band,
    ...plates.map((b) => ({ x: b.x - 10, y: b.y - 10, width: b.width + 20, height: b.height + 20 })),
    { x: 0, y: 0, width: profile.width * dpr, height: Math.round(profile.height * dpr * 0.125) },
    { x: 0, y: Math.round(profile.height * dpr * 0.855), width: profile.width * dpr, height: Math.round(profile.height * dpr * 0.145) },
  ];
  readback.frames.push({
    name,
    profile: profile.id,
    stamp: await stamp(page),
    screen: await page.evaluate(() => window.__mainMenu?.screen ?? null),
    ink,
  });
  writeFileSync(join(SHOTS, `${name}-ink.json`), `${JSON.stringify(ink, null, 2)}\n`);
  console.log(`${name}: stamp=${JSON.stringify(readback.frames.at(-1).stamp)}`);
  await page.close();
}

mkdirSync(SHOTS, { recursive: true });
note(`${TAG}-menu-readback`, readback);
await browser.close();
