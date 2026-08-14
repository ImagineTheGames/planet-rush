/**
 * evidence/a0-41-cost-every-page/capture.mjs — the three frames a0-41's PR needs.
 * OWNER: UI Engineer (a0-41); the golden gallery itself stays QA's.
 *
 * The re-baselined goldens in `tests/mobile/goldens.spec.ts-snapshots/` already
 * carry the main upgrade wheel at 99 ore (yellow) and 1 ore (red). These three
 * exist because none of them is a scene the golden suite has:
 *
 *  1. `upgrade-wheel-at-8-ore.png` — the wheel at **exactly the ore count in the
 *     developer's screenshot** (8), so `HULL 3/8 → 3`, `CARGO 6/8 → 6`,
 *     `ENGINE 7/8 → 7` is visible in the frame they complained about. Every
 *     upgrade golden is staged at 99 or 1.
 *
 *  2. `weapon-sub-wheel-at-8-ore.png` — **one level deeper**, reached by a REAL
 *     press on the WEAPON wedge, with DAMAGE and SPEED priced. This is the page
 *     the report says was missed ("none of the sub pages"), it appears in no
 *     golden in this repo, and a PR that shows only the main wheel has not shown
 *     the fix.
 *
 *  3. `upgrade-wheel-unaffordable.png` — an ore count where a track cannot be
 *     paid for, so the **red numeral carrying the whole message on its own** is
 *     on the record. That is the claim this change rests on: the colour was
 *     already saying what the denominator repeated.
 *
 * Staged through the shipped `?debug=1` seams — `__upgradeWheelStage.openUpgrade`
 * / `.wedges()`, the layout registry's drawn bounds, and `__pressStage.clientPoint`
 * for a real mouse click — and every staged value is read back off the seams
 * before the shutter, so a shot that staged wrong FAILS rather than lying.
 *
 * Usage:
 *   EVIDENCE_BASE_URL=http://localhost:4211 node evidence/a0-41-cost-every-page/capture.mjs
 */
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
mkdirSync(HERE, { recursive: true });
const BASE = process.env.EVIDENCE_BASE_URL ?? 'http://localhost:4173';

/** The developer's own ore count, from the 2026-08-13 screenshot. */
const DEV_ORE = 8;

function assert(ok, msg) {
  if (!ok) {
    console.error(`FAILED: ${msg}`);
    process.exitCode = 1;
    throw new Error(msg);
  }
}

/** Count render FRAMES rather than milliseconds — a loaded software-GL box fits
 *  unpredictably few frames into a fixed sleep (q8-01, tests/mobile/render-settle.ts). */
async function settle(page, frames = 8) {
  await page.evaluate(
    (n) =>
      new Promise((resolve) => {
        let seen = 0;
        const tick = () => (++seen >= n ? resolve() : requestAnimationFrame(tick));
        requestAnimationFrame(tick);
      }),
    frames,
  );
}

/** The frozen debug boot, settled the way goldens.spec.ts settles it. */
async function bootFrozen(page) {
  await page.goto(`${BASE}/?debug=1&freeze=1`);
  await page.waitForSelector('canvas', { state: 'attached', timeout: 30_000 });
  await page.waitForFunction(() => window.__planetRush?.frozen === true, undefined, { timeout: 20_000 });
  await page.evaluate(() => document.fonts?.ready);
  await settle(page);
}

/** Open the upgrade wheel with `ore` spendable, and return what it DREW. */
async function openUpgrade(page, ore) {
  const staged = await page.evaluate((o) => window.__upgradeWheelStage?.openUpgrade(o) ?? null, ore);
  assert(staged?.open === true, 'the ?debug=1 upgrade stage opened the wheel');
  await settle(page);
  return drawn(page);
}

const drawn = (page) =>
  page.evaluate(() =>
    window.__upgradeWheelStage.wedges().map((w) => ({
      label: w.label,
      cost: w.costLabel,
      paint: w.costPaint,
      stat: w.stat,
      tiers: w.tiers,
    })),
  );

/** Every cost slot on this page says one number, `MAX`, or `OPEN ▸` — asserted on
 *  the SHIPPED bundle, not on the model. This is the whole claim of the change. */
function assertNoDenominator(where, wedges) {
  assert(wedges.length > 0, `${where}: the wheel drew wedges at all`);
  for (const w of wedges) {
    assert(!w.cost.includes('/'), `${where}: ${w.label} priced "${w.cost}" — the denominator is back`);
    assert(
      /^\d+$/.test(w.cost) || w.cost === 'MAX' || w.cost === 'OPEN ▸',
      `${where}: ${w.label} drew "${w.cost}", which is not a price, MAX or OPEN ▸`,
    );
  }
}

const readback = {};
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });

// --- 1. The developer's frame: the upgrade wheel at 8 ore -------------------
await bootFrozen(page);
readback.mainWheelAt8 = await openUpgrade(page, DEV_ORE);
assertNoDenominator('main wheel @ 8 ore', readback.mainWheelAt8);
// The three tracks in the screenshot, by name, so the frame is pinned to it.
for (const label of ['HULL', 'ENGINE', 'CARGO']) {
  const w = readback.mainWheelAt8.find((x) => x.label === label);
  assert(w, `main wheel @ 8 ore: a ${label} wedge is drawn`);
  assert(/^\d+$/.test(w.cost), `${label} priced "${w.cost}", wanted a bare number`);
}
const weapon = readback.mainWheelAt8.find((w) => w.label === 'WEAPON');
assert(weapon?.cost === 'OPEN ▸', `WEAPON drew "${weapon?.cost}" — its arrow is untouched by this change`);
await page.screenshot({ path: join(HERE, 'upgrade-wheel-at-8-ore.png') });

// --- 2. ONE LEVEL DEEPER: the WEAPON sub-wheel, through a real press --------
//
// The page the report names. WEAPON is wedge 0 — twelve o'clock on the main
// wheel — and this is a REAL mouse click on it, at the wheel's drawn bounds,
// exactly the way `upgrade-wheel-gantry.spec.ts` navigates.
//
// NOT `__pressStage.press('upgrade', 0)`: that seam drives the press-feedback
// MOTION (scale, glow, shake) and nothing else — it never navigates, so it
// leaves the frame on the main wheel. The assertion below is what caught that.
{
  const bounds = await page.evaluate(
    () => window.__planetRush?.layout.find((e) => e.id === 'upgrade-wheel')?.bounds ?? null,
  );
  assert(bounds, 'the layout registry has the upgrade wheel this frame');
  const cx = bounds.x + bounds.width / 2;
  const cy = bounds.y + bounds.height / 2;
  // 0.6 of the outer radius sits inside the wedge ring (0.32‥1.0), where the
  // words are — the honest middle of the pressable wedge. Wedge 0 is at twelve
  // o'clock on a 4-wedge wheel.
  const angle = -Math.PI / 2;
  const at = await page.evaluate(
    (p) => window.__pressStage.clientPoint(p.x, p.y),
    { x: cx + Math.cos(angle) * (bounds.width / 2) * 0.6, y: cy + Math.sin(angle) * (bounds.width / 2) * 0.6 },
  );
  await page.mouse.click(at.x, at.y);
}
await settle(page, 12);
readback.weaponSubWheelAt8 = await drawn(page);
assert(
  readback.weaponSubWheelAt8.some((w) => w.label === 'DAMAGE') &&
    readback.weaponSubWheelAt8.some((w) => w.label === 'SPEED'),
  `the WEAPON press did not land on the sub-wheel — drew ${JSON.stringify(
    readback.weaponSubWheelAt8.map((w) => w.label),
  )}`,
);
assertNoDenominator('WEAPON sub-wheel @ 8 ore', readback.weaponSubWheelAt8);
await page.screenshot({ path: join(HERE, 'weapon-sub-wheel-at-8-ore.png') });

// --- 3. The red numeral, carrying the message alone -------------------------
//
// 1 ore buys nothing on this ladder (the cheapest tier is 2), so every track
// wedge is `unaffordable` and every numeral draws in threat red — with no
// denominator left to repeat it.
await bootFrozen(page);
readback.mainWheelShort = await openUpgrade(page, 1);
assertNoDenominator('main wheel @ 1 ore', readback.mainWheelShort);
const tracks = readback.mainWheelShort.filter((w) => w.label !== 'WEAPON');
assert(tracks.length > 0, 'the short frame drew track wedges');
for (const w of tracks) {
  assert(w.paint === 'refused', `${w.label} painted "${w.paint}" at 1 ore, wanted the threat red`);
  assert(/^\d+$/.test(w.cost), `${w.label} priced "${w.cost}" at 1 ore, wanted a bare number`);
}
await page.screenshot({ path: join(HERE, 'upgrade-wheel-unaffordable.png') });

writeFileSync(join(HERE, 'readback.json'), `${JSON.stringify(readback, null, 2)}\n`);
await browser.close();
console.log(JSON.stringify(readback, null, 2));
