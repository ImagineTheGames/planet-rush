/**
 * evidence/a0-03-wheel-cost/capture.mjs — the two frames a0-03's PR body needs.
 * OWNER: UI Engineer (a0-03); the gallery itself stays QA's.
 *
 * The goldens in `tests/mobile/goldens.spec.ts-snapshots/` already carry the wheel
 * at both ore levels and the HUD caption, and they are the re-baselined evidence.
 * These two shots exist because neither of them is a scene the golden suite has:
 *
 *  1. `wheel-at-2-ore.png` — the wheel opened at **exactly the ore count in the
 *     developer's screenshot** (2 held, nothing banked, a damaged reactor), so the
 *     `5/2 → 5`, `6/2 → 6`, `1/2 → 1` change is visible in the frame they
 *     complained about. The build-wheel goldens are staged at 4 and 8 ore.
 *
 *  2. `ore-collision.png` — the top-left readout and the wheel hub **in one frame,
 *     at a hold that is not empty** (hold 3, bank 5), because both now say the word
 *     `ORE` over two different numbers: 5 top-left (bank alone), 8 in the hub
 *     (`spendableOre` = hold + bank). Every golden stages `cargo = 0`, so no
 *     existing baseline can show this. This is the frame the developer is being
 *     asked to rule on.
 *
 * Both are staged through the shipped `?debug=1` seams — `__pressStage.openBuild`
 * (park docked, fund the bank, open the wheel), `__repairStage.siege` (park
 * docked with the wheel open and damage the reactor through the sim's own damage
 * path, so REPAIR REACTOR is live rather than inert), `__oreHudStage.dock` (set
 * the hold) — and every staged value is read back off the seams
 * before the shutter, so a shot that staged wrong FAILS rather than lying.
 *
 * Usage:
 *   EVIDENCE_BASE_URL=http://localhost:4197 node evidence/a0-03-wheel-cost/capture.mjs
 */
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
mkdirSync(HERE, { recursive: true });
const BASE = process.env.EVIDENCE_BASE_URL ?? 'http://localhost:4173';

/** Wait for the frozen debug boot to be genuinely settled (goldens.spec.ts's own
 *  discipline: canvas attached, `frozen` true, fonts loaded, frames drawn). */
async function bootFrozen(page) {
  await page.goto(`${BASE}/?debug=1&freeze=1`);
  await page.waitForSelector('canvas', { state: 'attached', timeout: 30_000 });
  await page.waitForFunction(() => window.__planetRush?.frozen === true, undefined, { timeout: 20_000 });
  await page.evaluate(() => document.fonts?.ready);
  await settle(page);
}

/**
 * Boot `?debug=1` WITHOUT `?freeze=1`, for the one shot that cannot use the
 * frozen scene.
 *
 * `?freeze=1` stamps `stampDefenseShowcase` (src/platform/freeze.ts), which stands
 * the local station's shields at their cap — so SHIELD prices `FULL` there and can
 * never show the `5` the developer's screenshot has. Their frame was a live match
 * with shields still buildable, and no seam un-stamps the showcase; adding one to
 * `main.ts` to take a screenshot would be a shipped debug mutator bought for a PR
 * body, so this boots live instead.
 *
 * The cost is that the sim steps, so this frame is NOT byte-deterministic the way
 * a golden is. It does not need to be — it is an illustration for the PR, not a
 * baseline, and every number in it is read back off the seams immediately before
 * the shutter, so a shot that staged wrong still FAILS rather than lying.
 */
async function bootLive(page) {
  await page.goto(`${BASE}/?debug=1`);
  await page.waitForSelector('canvas', { state: 'attached', timeout: 30_000 });
  await page.waitForFunction(() => !!window.__repairStage, undefined, { timeout: 20_000 });
  await page.evaluate(() => document.fonts?.ready);
  await settle(page);
}

/** Count render frames rather than milliseconds — a loaded software-GL box fits
 *  unpredictably few frames into a fixed sleep, and shoots one the renderer has
 *  not drawn yet (the q8-01 lesson, tests/mobile/render-settle.ts). */
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

const readback = {};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });

// --- 1. The developer's own frame: 2 ore held, nothing banked ---------------
await bootLive(page);
await page.evaluate(() => {
  // Park docked with the wheel open, put 60 damage on the reactor through the
  // sim's own damage path — so REPAIR REACTOR is a live `1` rather than an inert
  // one, exactly as in the developer's screenshot — and fund the ship with the
  // screenshot's 2 ore.
  //
  // The 2 goes in the BANK, not the hold. The wheel prices against
  // `spendableOre` = hold + bank, so every label below is identical either way,
  // and on a LIVE boot a ship parked in dock range deposits its hold into the
  // bank within a few ticks (the deposit rule `__oreHudStage.mine` deliberately
  // flies away from) — which would drain a staged hold before the shutter.
  window.__repairStage.siege(60, 2);
});
await settle(page);
readback.wheelAt2Ore = await page.evaluate(() => ({
  ore: window.__oreHudStage.readout(),
  core: window.__repairStage.readout(),
  wedges: window.__pressStage.wedges().map((w) => ({ id: w.id, cost: w.costLabel, paint: w.costPaint, caps: w.caps })),
}));
const at2 = readback.wheelAt2Ore;
assert(
  at2.ore.cargo + at2.ore.banked === 2,
  `spendable ore staged to 2, got hold ${at2.ore.cargo} + bank ${at2.ore.banked}`,
);
for (const [id, want, paint] of [
  ['shield', '5', 'refused'],
  ['satellite', '6', 'refused'],
  ['repair', '1', 'ore'],
]) {
  const w = at2.wedges.find((x) => x.id === id);
  assert(w?.cost === want, `${id} cost label is "${w?.cost}", wanted "${want}"`);
  assert(w?.paint === paint, `${id} cost paint is "${w?.paint}", wanted "${paint}"`);
}
await page.screenshot({ path: join(HERE, 'wheel-at-2-ore.png') });

// --- 1b. The same scene with the lower-centre prompt out of the way ---------
//
// The shot above is the developer's frame and keeps its furniture: SHIELD `5` and
// RADAR `6` both read, in threat red. But the onboarding prompt is anchored
// lower-centre and lands on REPAIR REACTOR's fourth line — which is the one
// PAYABLE cost in the frame, the yellow `1` the developer's table asks for.
//
// Waiting it out does not work, and the layout registry says why: an `onboarding`
// rect is reported indefinitely. The under-attack prompt's alarm does decay, but
// the SPEND prompt ("Spend ore on defense — or UPGRADE SHIP…") fires the moment
// the wheel is open with nothing ordered and stays — which is exactly why every
// shipped build-wheel golden carries a toast in that band too. Retiring it means
// placing an order, and an order spends the ore this frame is staged AT.
//
// So give the frame more room instead. The prompt is bottom-anchored and the
// wheel is centred, so the gap between them is `height/2 - radius - pad`: a taller
// viewport separates them without touching a single value in the scene. Same
// staging, same 2 ore, same labels — re-asserted below before the shutter.
{
  const tall = await browser.newPage({ viewport: { width: 1280, height: 1100 }, deviceScaleFactor: 1 });
  await tall.goto(`${BASE}/?debug=1`);
  await tall.waitForSelector('canvas', { state: 'attached', timeout: 30_000 });
  await tall.waitForFunction(() => !!window.__repairStage, undefined, { timeout: 20_000 });
  await tall.evaluate(() => document.fonts?.ready);
  await settle(tall);
  await tall.evaluate(() => window.__repairStage.siege(60, 2));
  await settle(tall);
  const page = tall; // the assertions below read the frame they shoot
  readback.wheelAt2OreClear = await page.evaluate(() => ({
    ore: window.__oreHudStage.readout(),
    wedges: window.__pressStage.wedges().map((w) => ({ id: w.id, cost: w.costLabel, paint: w.costPaint, caps: w.caps })),
  }));
  const clear = readback.wheelAt2OreClear;
  // The scene is live and this is a second boot, so re-assert every number rather
  // than assume it matches the frame above.
  assert(
    clear.ore.cargo + clear.ore.banked === 2,
    `spendable ore is hold ${clear.ore.cargo} + bank ${clear.ore.banked}, wanted 2`,
  );
  const repair = clear.wedges.find((w) => w.id === 'repair');
  assert(repair?.cost === '1', `REPAIR REACTOR cost is "${repair?.cost}", wanted "1"`);
  assert(repair?.paint === 'ore', `REPAIR REACTOR is "${repair?.paint}", wanted the payable yellow`);
  const shield = clear.wedges.find((w) => w.id === 'shield');
  assert(shield?.cost === '5' && shield?.paint === 'refused', `SHIELD is "${shield?.cost}"/${shield?.paint}`);
  await page.screenshot({ path: join(HERE, 'wheel-at-2-ore-unobstructed.png') });
  await tall.close();
}

// --- 2. The ORE / ORE collision, at a hold that is not empty ----------------
await bootFrozen(page);
await page.evaluate(() => {
  window.__pressStage.openBuild(5); // bank 5, wheel open, docked
  window.__oreHudStage.dock(3); // hold 3 — openBuild zeroes the hold, so this is second
});
await settle(page);
readback.collision = await page.evaluate(() => ({
  sim: window.__oreHudStage.readout(),
  drawnTopLeft: window.__oreHudStage.total(),
  wedges: window.__pressStage.wedges().map((w) => ({ id: w.id, cost: w.costLabel, paint: w.costPaint })),
}));
const c = readback.collision;
assert(c.sim.cargo === 3 && c.sim.banked === 5, `staged hold/bank is ${c.sim.cargo}/${c.sim.banked}, wanted 3/5`);
assert(c.drawnTopLeft === 5, `the top-left DREW ${c.drawnTopLeft}, wanted the bank alone (5)`);
// The hub prints spendableOre = 8; at 8 ore RADAR's 6 is payable, which is the
// cheap, checkable proof that the hub really is pricing against hold + bank.
const radar = c.wedges.find((w) => w.id === 'satellite');
assert(radar?.paint === 'ore', `RADAR is "${radar?.paint}" at hold 3 + bank 5 — the hub is not counting the hold`);
await page.screenshot({ path: join(HERE, 'ore-collision.png') });

writeFileSync(join(HERE, 'readback.json'), `${JSON.stringify(readback, null, 2)}\n`);
await browser.close();
console.log(JSON.stringify(readback, null, 2));

function assert(ok, msg) {
  if (!ok) {
    console.error(`FAILED: ${msg}`);
    process.exitCode = 1;
    throw new Error(msg);
  }
}
