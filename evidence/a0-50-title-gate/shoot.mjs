/**
 * evidence/a0-50-title-gate/shoot.mjs — the door, operated, photographed.
 * OWNER: UI Engineer (a0-50).
 *
 * The claim this screen makes is that the main menu is GENUINELY behind it — not
 * a picture of a menu drawn on a door. That claim can only be photographed, and
 * the way it fails cannot: the failure state is a doorway that looks like a
 * doorway right up until the leaves part.
 *
 * So this shoots two passes over the same build, one press each:
 *
 *  - `after-*` — the shipped screen. Through the parting leaves you can read
 *    CODEX and SETTINGS on the real `MainMenuView` behind it.
 *  - `before-*` — the same screen with the defect put back at RUNTIME (the
 *    overlay root repainted in the ground colour, which is what shipped until
 *    this brief's last commit). Same build, same seed, same timings, so the only
 *    variable is the one being shown.
 *
 * Regenerable, and it needs nothing staged:
 *
 *     npm run build && npx vite preview --port 4195 --strictPort &
 *     node evidence/a0-50-title-gate/shoot.mjs
 *
 * `EVIDENCE_BASE_URL` overrides the origin; `EVIDENCE_OUT` the directory.
 */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = process.env.EVIDENCE_BASE_URL ?? 'http://localhost:4195';
const OUT = process.env.EVIDENCE_OUT ?? dirname(fileURLToPath(import.meta.url));
const VP = { width: 1280, height: 800 };

/** The gate's own beat schedule (`src/ui/title-gate.ts` GATE_OPEN_STEPS), and
 *  the instant inside each beat that says the most about it. */
const BEATS = [
  { name: '1-sealed', at: 0, says: 'the wordmark, stamped into the leaves' },
  { name: '2-turning', at: 700, says: 'the rotor has thrown 135 degrees; nothing else has moved' },
  { name: '3-parting', at: 1500, says: 'the leaves part, and the MENU is what is behind them' },
  { name: '4-entering', at: 2600, says: 'the frame grows until its opening clears the screen' },
  { name: '5-through', at: 3900, says: 'the menu was there the whole time' },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Repaint the overlay root opaque — the defect exactly as it shipped, put back
 *  at runtime so the pair comes off ONE build. */
const PUT_THE_LID_BACK = () => {
  const el = document.getElementById('pr-title-gate');
  if (el) el.style.background = '#070910';
  return !!el;
};

async function pass(page, prefix, lid) {
  await page.goto(`${BASE}/`, { waitUntil: 'load' });
  await page.waitForSelector('canvas', { state: 'attached', timeout: 30_000 });
  await page.waitForFunction(() => window.__mainMenu?.visible === true, undefined, { timeout: 20_000 });
  await page.evaluate(() => document.fonts?.ready).catch(() => {});
  await sleep(1200);

  if (lid) {
    const found = await page.evaluate(PUT_THE_LID_BACK);
    if (!found) throw new Error('the gate did not mount — nothing to put a lid on');
  }

  // The clock starts at the press, and every wait below is measured from it, so
  // the screenshots' own cost cannot drift the beats apart.
  const t0 = Date.now();
  let pressed = false;
  for (const beat of BEATS) {
    const wait = beat.at - (Date.now() - t0);
    if (wait > 0) await sleep(wait);
    await page.screenshot({ path: join(OUT, `${prefix}-${beat.name}.png`) });
    if (!pressed) {
      await page.mouse.click(VP.width / 2, VP.height / 2);
      pressed = true;
    }
    console.log(`${prefix}-${beat.name}.png  ${beat.says}`);
  }
}

/**
 * The landscape lock, on a handset. A phone held PORTRAIT gets a game rotated
 * +90° so the player turns it, and the overlay takes the same transform — which
 * it did not until this brief, and the result was unreadable: the lock is sized
 * off `vh`, and in portrait `vh` is the long side.
 */
async function phone(browser, orientation, vp) {
  const ctx = await browser.newContext({
    viewport: vp,
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
  });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/`, { waitUntil: 'load' });
  await page.waitForSelector('canvas', { state: 'attached', timeout: 30_000 });
  await page.waitForFunction(() => window.__mainMenu?.visible === true, undefined, { timeout: 20_000 });
  await page.evaluate(() => document.fonts?.ready).catch(() => {});
  await sleep(1500);
  await page.screenshot({ path: join(OUT, `phone-${orientation}-sealed.png`) });

  const rotated = await page.evaluate(() => window.__mainMenu?.rotated ?? null);
  await page.touchscreen.tap(vp.width / 2, vp.height / 2);
  await sleep(1500);
  await page.screenshot({ path: join(OUT, `phone-${orientation}-parting.png`) });
  console.log(`phone-${orientation}-*.png  the game root is rotated: ${rotated}`);
  await ctx.close();
  return rotated;
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: VP, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  await pass(page, 'after', false);
  await pass(page, 'before', true);

  const portraitRotated = await phone(browser, 'portrait', { width: 390, height: 844 });
  const landscapeRotated = await phone(browser, 'landscape', { width: 844, height: 390 });

  // …and the flag the harness boots with: no door, and the menu untouched.
  await page.goto(`${BASE}/?gate=0`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__mainMenu?.visible === true, undefined, { timeout: 20_000 });
  await sleep(1200);
  const mounted = await page.evaluate(() => !!document.getElementById('pr-title-gate'));
  await page.screenshot({ path: join(OUT, 'gate-off.png') });
  console.log(`gate-off.png  ?gate=0 mounts a gate: ${mounted}`);

  console.log(`page errors: ${JSON.stringify(errors)}`);
  await browser.close();
  if (mounted) throw new Error('?gate=0 still mounted the gate');
  if (errors.length) throw new Error('the screen logged errors');
  // The two phone passes only mean anything if the lock actually engaged on one
  // of them and stayed out of the way on the other.
  if (portraitRotated !== true) throw new Error('the landscape lock did not engage in portrait');
  if (landscapeRotated !== false) throw new Error('the landscape lock engaged on a landscape phone');
}

await main();
