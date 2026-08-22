/**
 * evidence/a0-129-the-stamp-stays-readable/shoot-map-select.mjs — the build stamp
 * on MAP SELECT, before and after. OWNER: UI Engineer (a0-129).
 *
 * a0-127's finding, in its own words: *"the client reports drawing it at
 * `{8,363 43.5x13}` on this screen. VISIBLE at 4x: the stamp reads `0910de2*`,
 * and the BACK plate's angled lower-left corner is drawn across its right-hand
 * half, with the plate's white accent bar landing on the final character."*
 *
 * So this capture answers exactly that, on exactly that screen, at exactly that
 * magnification, on two bundles:
 *
 *   BEFORE — `main` as it stands, built from a second worktree, on its own port.
 *   AFTER  — this branch.
 *
 * The screen is reached the way a player reaches it — real taps at the points the
 * client itself reports drawing its controls at, PLAY -> PLAY SOLO -> the lobby's
 * arena card — never a seam that just sets the state. Nothing is stubbed.
 *
 * Two images per bundle: the full frame at true size (1 image px per device px of
 * a dpr-2 phone, which is what the eye receives) and a 4x nearest-neighbour crop
 * of a FIXED rectangle around the stamp's corner. The rectangle is fixed — the
 * same logical rect on both bundles — because the thing being compared is what is
 * drawn in that corner, and a crop that followed the plate would move the frame
 * out from under the comparison.
 */
import { chromium } from 'playwright';
import {
  AFTER_BASE,
  BEFORE_BASE,
  PHONE,
  bootMenu,
  crop,
  elements,
  frame,
  note,
  pageOptions,
  park,
  pixelStats,
  plateTop,
  settle,
  shotPath,
  stamp,
  writeCrop,
} from './lib.mjs';

/** The corner the stamp lives in, logical px: the bottom-left 200x40 of the
 *  screen. Wide enough to hold the whole tag and the plate's lower-left corner,
 *  short enough that a 4x crop is still a picture of one thing. */
const CORNER = { x: 0, y: PHONE.height - 40, w: 200, h: 40 };

const browser = await chromium.launch();
const readback = [];

for (const [tag, base] of [
  ['before', BEFORE_BASE],
  ['after', AFTER_BASE],
]) {
  const page = await browser.newPage(pageOptions(PHONE));
  page.on('pageerror', (e) => console.log('  [pageerror]', e.message));
  const press = async (p) => {
    if (!p) throw new Error('control not reported by the client');
    await page.touchscreen.tap(p.x, p.y);
    await settle(page, 10);
  };

  await bootMenu(page, base);
  await press(
    await page.evaluate(() => {
      const c = window.__mainMenu.controls.find((k) => k.kind === 'play');
      return c ? { ...c.physicalCenter } : null;
    }),
  );
  await press(
    await page.evaluate(() => {
      const c = (window.__onlineMenu?.doorControls ?? []).find((k) => k.kind === 'solo');
      return c ? { ...c.physicalCenter } : null;
    }),
  );
  await page.waitForFunction(() => typeof window.__lobby?.rush === 'function', undefined, { timeout: 30_000 });
  await press(
    await page.evaluate(() =>
      window.__lobby?.mapCardControl ? { ...window.__lobby.mapCardControl.physicalCenter } : null,
    ),
  );
  await page.waitForFunction(() => window.__lobby?.screen === 'map-select', undefined, { timeout: 30_000 });
  await park(page);

  const name = `map-select-${tag}`;
  await frame(page, name);

  // The stamp's rect off the client's own seam — the rect a0-127 quoted. Note
  // what `elements` comes back as on this screen: `null`. The layout registry's
  // read-back (`__cornerStage`) is built in the match boot and does not exist on
  // a menu, which is the sentence this whole brief turns on.
  const els = await elements(page);
  const badge = await stamp(page);
  const stampRect = badge?.bounds ?? null;
  if (!stampRect) throw new Error('the client reported no build stamp on this screen');

  // What is behind it, measured off the pixels: there is no seam that reports
  // MAP SELECT's BACK plate (see the README), so the plate's top edge is found
  // in the frame itself, in the stamp's own column span.
  const path = shotPath(name);
  readback.push({
    name,
    bundle: tag,
    profile: PHONE.id,
    stamp: { text: badge.text, visible: badge.visible, withinAnchor: badge.withinAnchor },
    stampRect,
    behindTheStamp: pixelStats(path, stampRect, PHONE.dpr),
    plateTopInStampColumns: plateTop(path, { x: stampRect.x, width: stampRect.width }, PHONE.dpr),
    stampRowTop: stampRect.y,
    registryReadback: els,
  });

  writeCrop(
    `${name}-corner-4x`,
    crop(shotPath(name), {
      x: Math.round(CORNER.x * PHONE.dpr),
      y: Math.round(CORNER.y * PHONE.dpr),
      w: Math.round(CORNER.w * PHONE.dpr),
      h: Math.round(CORNER.h * PHONE.dpr),
      scale: 4,
    }),
  );
  const r = readback[readback.length - 1];
  console.log(
    `${name}: stamp ${JSON.stringify(stampRect)} | behind it max L=${r.behindTheStamp.max} ` +
      `mean L=${r.behindTheStamp.mean} | plate top ${r.plateTopInStampColumns}`,
  );
  await page.close();
}

note('map-select-readback', { corner: CORNER, profile: PHONE, frames: readback });
await browser.close();
