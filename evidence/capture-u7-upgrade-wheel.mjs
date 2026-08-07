/**
 * evidence/capture-u7-upgrade-wheel.mjs — u7-06, the Gantry/Bone upgrade wheel.
 *
 * WHAT IT PROVES: the screen behind the build wheel's UPGRADE SHIP wedge — **the
 * place ship stats are shown** (GDD §2.5) — carries the same four-line stack the
 * build wheel got in u7-02, on a pointer device and a touch device, in landscape
 * and portrait-held. Three states per profile:
 *
 *   upgrade        99 ore banked: every tier payable, so every `cost/held`
 *                  numeral draws in signal yellow.
 *   upgrade-short   1 ore banked: the same numerals in threat red, wedges dark.
 *                  Nothing else on the wheel takes red (style-guide §2.1).
 *   weapon         the nested WEAPON sub-wheel, where DAMAGE and SPEED carry the
 *                  same four lines as the tracks on the level above.
 *
 * It reaches the wheel through the `?debug=1` `__upgradeWheelStage` seam rather
 * than through a real press, deliberately: the REAL press path is what
 * `tests/mobile/upgrade-wheel-gantry.spec.ts` gates, and this script's job is a
 * deterministic, comparable PICTURE of the drawn result. `?freeze=1` pins the
 * seeded sim so the same frame is drawn on every boot.
 *
 * Usage (the OUT_PREFIX is what makes before/after pairs):
 *   npm run build && npx vite preview --port 4173 --strictPort &
 *   OUT_PREFIX=after node evidence/capture-u7-upgrade-wheel.mjs
 */
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'images', 'u7-gantry-upgrade-wheel');
const BASE = process.env.EVIDENCE_BASE_URL ?? 'http://localhost:4173';
const PREFIX = process.env.OUT_PREFIX ?? 'after';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

mkdirSync(OUT, { recursive: true });

/** QA's own device matrix, plus the pointer control. Portrait is included
 *  deliberately — the game locks to landscape, so a portrait-HELD phone renders
 *  the rotated canvas, and that is a real device state for a radial control. */
const PROFILES = [
  { id: 'desktop', viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, touch: false },
  { id: 'phone-landscape', viewport: { width: 844, height: 390 }, deviceScaleFactor: 3, touch: true },
  { id: 'phone-portrait', viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, touch: true },
];

/** Flush enough that every tier on the ladder is payable. */
const ORE_FLUSH = 99;
/** One ore buys nothing here — the cheapest tier is 2 — so every cost is refused. */
const ORE_SHORT = 1;

const browser = await chromium.launch({
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});

const report = { capture: 'u7-06-gantry-upgrade-wheel', side: PREFIX, base: BASE, profiles: [] };

for (const profile of PROFILES) {
  const ctx = await browser.newContext({
    viewport: profile.viewport,
    deviceScaleFactor: profile.deviceScaleFactor,
    isMobile: profile.touch,
    hasTouch: profile.touch,
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });

  await page.goto(`${BASE}/?debug=1&freeze=1`, { waitUntil: 'load', timeout: 60_000 });
  await page.waitForSelector('canvas', { state: 'attached', timeout: 30_000 });
  await page.waitForFunction(
    () => {
      const pr = window.__planetRush;
      return !!pr && pr.frozen === true;
    },
    undefined,
    { timeout: 30_000 },
  );
  await page.evaluate(() => document.fonts?.ready);
  await sleep(700);

  const shots = [];

  /** Stage a wheel level at a bank, let it draw, shoot it, and record the lines
   *  the client reported so the JSON says what the PNG shows. */
  const shoot = async (name, stage) => {
    await page.evaluate(stage.fn, stage.arg);
    await sleep(700);
    const file = join(OUT, `${PREFIX}-${profile.id}-${name}.png`);
    await page.screenshot({ path: file });
    const wedges = await page.evaluate(() => {
      const s = window.__upgradeWheelStage;
      return s ? s.wedges() : [];
    });
    shots.push({
      name,
      file: file.replace(`${HERE}/`, ''),
      wedges: wedges.map((w) => ({
        label: w.label,
        // `stat`/`costLabel`/`tiers` only exist on the u7-06 side; the before
        // side reports the model fields it had, so the JSON is honest either way.
        stat: w.stat ?? null,
        costLabel: w.costLabel ?? null,
        tiers: w.tiers ?? null,
        current: w.current,
        next: w.next,
        cost: w.cost,
        state: w.state,
        costPaint: w.costPaint ?? null,
      })),
    });
  };

  await shoot('upgrade', {
    fn: (o) => {
      const s = window.__upgradeWheelStage;
      s?.openUpgrade(o);
    },
    arg: ORE_FLUSH,
  });
  await shoot('upgrade-short', {
    fn: (o) => {
      const s = window.__upgradeWheelStage;
      s?.setOre(o);
    },
    arg: ORE_SHORT,
  });
  await shoot('weapon', {
    fn: (o) => {
      const s = window.__upgradeWheelStage;
      s?.setOre(o);
      s?.openWeapon();
    },
    arg: ORE_FLUSH,
  });

  report.profiles.push({ id: profile.id, viewport: profile.viewport, shots, errors });
  await ctx.close();
  console.log(`[${PREFIX}] ${profile.id}: ${shots.length} shots, ${errors.length} console errors`);
}

await browser.close();
writeFileSync(join(OUT, `${PREFIX}.json`), `${JSON.stringify(report, null, 2)}\n`);
console.log(`wrote ${join(OUT, `${PREFIX}.json`)}`);
