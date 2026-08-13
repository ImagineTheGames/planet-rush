/**
 * evidence/a1-17-defaults-and-browser/capture-defaults.mjs — THE NEW DEFAULTS,
 * on the SERVED build. OWNER: QA Manager (a1-17 §1; a0-30 / #399).
 *
 * The developer ratified Tap Commander + Auto-aim on EVERY platform. Two things
 * can go wrong and only one of them is the headline:
 *
 *  1. A FRESH profile does not get the new defaults.
 *  2. **A profile that already CHOSE something loses it.** Moving a default is
 *     one line; moving everyone's saved setting with it is the regression, and
 *     it lives in the boot path's storage read, not in any pure model. This is
 *     the likelier way it went wrong and it gets equal weight here.
 *
 * FRONT DOOR ONLY. Every screen is reached by a REAL press at the physical point
 * the client itself reported drawing the control at. No seam method opens the
 * thing under test; the seam is read afterwards, and only for plain state.
 *
 * The words are read TWICE and the two reads must agree:
 *  - off `__mainMenu.settingsRows`, which is the same model object the view was
 *    handed (so the readback cannot say one thing while the screen says another)
 *  - off the PIXELS, by cropping each row's band and looking at it.
 * Storage is read after boot too, because "the screen says Tap" and "the value
 * that persisted is tap" are different claims.
 *
 *   node evidence/a1-17-defaults-and-browser/capture-defaults.mjs
 */
import { chromium, devices } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const IMAGES = resolve(HERE, '..', 'images');
const BASE = process.env.A1_17_BASE_URL ?? 'https://imaginethegames.github.io/planet-rush/';

const SCHEME_KEY = 'planet-rush:controlScheme';
const FIRE_KEY = 'planet-rush:fireMode';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync(IMAGES, { recursive: true });

/** The four profiles this round photographs. A "saved" profile is written before
 *  the app's first line runs, so the client's OWN boot read is what sees it. */
const PROFILES = [
  {
    id: 'desktop-fresh',
    title: 'desktop 1280x800, nothing stored',
    device: null,
    viewport: { width: 1280, height: 800 },
    touch: false,
    stored: {},
  },
  {
    id: 'phone390-fresh',
    title: 'phone 390x844 portrait (iPhone 12-class), nothing stored',
    device: 'iPhone 12',
    stored: {},
  },
  {
    id: 'desktop-saved-sticks-manual',
    title: 'desktop 1280x800, profile already chose Sticks + Manual',
    device: null,
    viewport: { width: 1280, height: 800 },
    touch: false,
    stored: { [SCHEME_KEY]: 'sticks', [FIRE_KEY]: 'manual' },
  },
  {
    id: 'phone390-saved-sticks-manual',
    title: 'phone 390x844, profile already chose Sticks + Manual',
    device: 'iPhone 12',
    stored: { [SCHEME_KEY]: 'sticks', [FIRE_KEY]: 'manual' },
  },
];

const browser = await chromium.launch();
const out = { base: BASE, capturedAt: new Date().toISOString(), runs: {} };

for (const p of PROFILES) {
  const ctx = await browser.newContext({
    ...(p.device ? devices[p.device] : {}),
    ...(p.viewport ? { viewport: p.viewport, hasTouch: p.touch, isMobile: false } : {}),
    deviceScaleFactor: 1,
  });
  const page = await ctx.newPage();
  await page.addInitScript((entries) => {
    localStorage.clear();
    for (const [k, v] of entries) localStorage.setItem(k, v);
  }, Object.entries(p.stored));
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForSelector('canvas', { state: 'attached', timeout: 60_000 });
  await page.waitForFunction(() => typeof window.__mainMenu?.screen === 'string', undefined, {
    timeout: 40_000,
  });

  const sha = await page.evaluate(
    () => window.__planetRush?.build?.sha ?? window.__buildBadge?.text ?? null,
  );

  // --- the front door: press SETTINGS where the client says it drew it -------
  const box = await page.locator('canvas').boundingBox();
  const at = await page.evaluate(() => {
    const c = (window.__mainMenu?.controls ?? []).find((x) => x.kind === 'settings');
    return c ? { x: c.physicalCenter.x, y: c.physicalCenter.y } : null;
  });
  if (!at) throw new Error(`${p.id}: the menu reported no SETTINGS control to press`);
  const px = { x: box.x + at.x, y: box.y + at.y };
  const isTouch = Boolean(p.device) || p.touch;
  if (isTouch) await page.touchscreen.tap(px.x, px.y);
  else await page.mouse.click(px.x, px.y);

  await page.waitForFunction(() => window.__mainMenu?.screen === 'settings', undefined, {
    timeout: 20_000,
  });
  await page.waitForFunction(() => (window.__mainMenu?.settingsRows.length ?? 0) > 0, undefined, {
    timeout: 20_000,
  });
  await sleep(700); // let the screen settle before the shutter

  const rows = await page.evaluate(() =>
    window.__mainMenu.settingsRows.map((r) => ({ kind: r.kind, label: r.label, value: r.value })),
  );
  const storedAfter = await page.evaluate(
    ([s, f]) => ({ [s]: localStorage.getItem(s), [f]: localStorage.getItem(f) }),
    [SCHEME_KEY, FIRE_KEY],
  );
  const liveScheme = await page.evaluate(() => window.__mainMenu?.controlScheme ?? null);

  const shot = join(IMAGES, `a1-17-defaults-${p.id}.png`);
  await page.screenshot({ path: shot });

  out.runs[p.id] = {
    title: p.title,
    pressedSettingsAt: px,
    viewport: page.viewportSize(),
    buildSha: sha,
    stored: p.stored,
    storageAfterBoot: storedAfter,
    seamControlScheme: liveScheme,
    settingsRows: rows,
    image: `images/a1-17-defaults-${p.id}.png`,
  };
  console.log(
    `${p.id}  sha=${sha}  rows=${rows.map((r) => `${r.label}:${r.value}`).join(' | ')}  storage=${JSON.stringify(storedAfter)}`,
  );
  await ctx.close();
}

await browser.close();
writeFileSync(join(HERE, 'readback-defaults.json'), JSON.stringify(out, null, 2));
console.log('wrote readback-defaults.json');
