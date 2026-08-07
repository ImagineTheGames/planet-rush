/**
 * evidence/capture-u8-controls-label.mjs — u8-01: what the CONTROLS row SAYS, on
 * each device, looked at rather than asserted. OWNER: UI Engineer.
 *
 * The bug was reported by looking at a screen ("this is wrong for pc"), so the fix
 * is evidenced the same way. Every frame here is a real front-door boot — no
 * `?debug=1`, no hit-test seam — and the row is read only by cropping the band the
 * client itself reports the CONTROLS row's centre at (`__mainMenu.settingsControls`).
 *
 *   DESKTOP   boot → SETTINGS → the row reads KEYBOARD + MOUSE
 *   + PAD     a synthetic gamepad through the `navigator.getGamepads` seam
 *             (`src/platform/input.ts`: "tests inject a fake") + a real
 *             `gamepadconnected` event → the row flips to TWIN STICKS
 *   − PAD     `gamepaddisconnected` → it flips BACK, and the crop is compared
 *             byte-for-byte against the pre-connect one, so "reverted" is proved
 *             rather than eyeballed
 *   TAP       a real click on the row → TAP COMMANDER, on the same PC
 *   PHONE     a touch profile (390×844 dpr 3, landscape-held) → STICKS, unchanged
 *
 * It also reads back the PERSISTED value at each step: the row's word moved, the
 * stored `planet-rush:controlScheme` string did not — it is still `sticks`.
 *
 * Usage: EVIDENCE_BASE_URL=http://localhost:4173 node evidence/capture-u8-controls-label.mjs
 */
import { chromium } from '@playwright/test';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'images');
const TMP = '/tmp/u8-controls';
const BASE = process.env.EVIDENCE_BASE_URL ?? 'http://localhost:4173';
const SCHEME_KEY = 'planet-rush:controlScheme';
mkdirSync(OUT, { recursive: true });
mkdirSync(TMP, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha = (path) => createHash('sha256').update(readFileSync(path)).digest('hex').slice(0, 16);

/** Stack crops into one strip, so the PR body carries a single picture. */
function stitchV(paths, outPath, gap = 10, bg = [12, 14, 18]) {
  const imgs = paths.map((p) => PNG.sync.read(readFileSync(p)));
  const w = Math.max(...imgs.map((i) => i.width));
  const h = imgs.reduce((s, i) => s + i.height, 0) + gap * (imgs.length - 1);
  const out = new PNG({ width: w, height: h });
  for (let i = 0; i < out.data.length; i += 4) {
    out.data[i] = bg[0];
    out.data[i + 1] = bg[1];
    out.data[i + 2] = bg[2];
    out.data[i + 3] = 255;
  }
  let oy = 0;
  for (const im of imgs) {
    const xo = Math.floor((w - im.width) / 2);
    for (let y = 0; y < im.height; y++) {
      for (let x = 0; x < im.width; x++) {
        const si = (y * im.width + x) * 4;
        const di = ((oy + y) * w + (xo + x)) * 4;
        out.data[di] = im.data[si];
        out.data[di + 1] = im.data[si + 1];
        out.data[di + 2] = im.data[si + 2];
        out.data[di + 3] = 255;
      }
    }
    oy += im.height + gap;
  }
  writeFileSync(outPath, PNG.sync.write(out));
}

/** The synthetic pad, installed BEFORE any page script runs so the client's own
 *  `navigator.getGamepads()` read (the only browser read behind TWIN STICKS) sees
 *  whatever this script decides it sees. */
const installFakeGamepads = (page) =>
  page.addInitScript(() => {
    window.__pads = [];
    navigator.getGamepads = () => window.__pads;
  });

const setPad = (page, connected) =>
  page.evaluate((on) => {
    const pad = {
      id: 'Synthetic Pad (u8-01 evidence)',
      index: 0,
      connected: true,
      mapping: 'standard',
      axes: [0, 0, 0, 0],
      buttons: Array.from({ length: 16 }, () => ({ pressed: false, touched: false, value: 0 })),
      timestamp: 0,
    };
    window.__pads = on ? [pad] : [];
    const e = new Event(on ? 'gamepadconnected' : 'gamepaddisconnected');
    e.gamepad = pad;
    window.dispatchEvent(e);
  }, connected);

const report = { probe: 'u8-01 CONTROLS label per device', base: BASE, capturedAt: new Date().toISOString(), steps: [] };
const browser = await chromium.launch();

/** Boot the front door, press SETTINGS for real, and hand back the crop helper. */
async function openSettings(context) {
  const page = await context.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errs.push(m.text());
  });
  await installFakeGamepads(page);
  await page.goto(BASE + '/', { waitUntil: 'load' });
  await page.waitForSelector('canvas', { state: 'attached', timeout: 30000 });
  await page.waitForFunction(() => typeof window.__mainMenu?.play === 'function', undefined, { timeout: 20000 });
  await page.evaluate(() => document.fonts?.ready).catch(() => {});
  await sleep(300);

  const box = await page.locator('canvas').boundingBox();
  const point = async (list, kind) =>
    page.evaluate(
      ({ list, kind }) => {
        const c = (window.__mainMenu?.[list] ?? []).find((x) => x.kind === kind);
        return c ? { x: c.physicalCenter.x, y: c.physicalCenter.y } : null;
      },
      { list, kind },
    );
  const click = async (list, kind) => {
    const p = await point(list, kind);
    if (!p) throw new Error(`no ${list} control '${kind}'`);
    await page.mouse.click(box.x + p.x, box.y + p.y);
    await sleep(250);
  };

  await click('controls', 'settings');
  const screen = await page.evaluate(() => window.__mainMenu?.screen);
  if (screen !== 'settings') throw new Error(`SETTINGS did not open (screen=${screen})`);

  /** Crop the band the client says the CONTROLS row sits in — full width, so the
   *  label and its chip are both in frame, and no coordinate is invented here. */
  const shotRow = async (name) => {
    const p = await point('settingsControls', 'controls');
    const vp = page.viewportSize();
    const half = Math.round(Math.min(60, vp.height / 8));
    const path = join(TMP, `${name}.png`);
    await page.screenshot({
      path,
      clip: {
        x: 0,
        y: Math.max(0, box.y + p.y - half),
        width: vp.width,
        height: Math.min(half * 2, vp.height),
      },
    });
    return path;
  };
  const shotFull = async (name) => {
    const path = join(OUT, `${name}.png`);
    await page.screenshot({ path });
    return path;
  };
  const stored = () => page.evaluate((k) => localStorage.getItem(k), SCHEME_KEY);

  return { page, errs, shotRow, shotFull, click, stored };
}

// --- DESKTOP: no pad → a pad → no pad → Tap Commander -----------------------
{
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  const s = await openSettings(context);

  const before = await s.shotRow('desktop-1-keyboard');
  await s.shotFull('u8-desktop-settings-keyboard-mouse');
  report.steps.push({ step: 'desktop, no pad', persisted: await s.stored(), crop: sha(before) });

  await setPad(s.page, true);
  await sleep(300);
  const withPad = await s.shotRow('desktop-2-gamepad');
  await s.shotFull('u8-desktop-settings-twin-sticks');
  report.steps.push({ step: 'desktop, pad connected', persisted: await s.stored(), crop: sha(withPad) });

  await setPad(s.page, false);
  await sleep(300);
  const afterPad = await s.shotRow('desktop-3-keyboard-again');
  report.steps.push({ step: 'desktop, pad disconnected', persisted: await s.stored(), crop: sha(afterPad) });

  // The row must be back to the pixel it was before the pad ever appeared.
  report.revertedExactly = sha(before) === sha(afterPad);
  report.padChangedTheRow = sha(before) !== sha(withPad);

  // The same row, clicked for real: the scheme moves, and so does the stored value.
  await s.click('settingsControls', 'controls');
  const tap = await s.shotRow('desktop-4-tap-commander');
  report.steps.push({ step: 'desktop, TAP COMMANDER', persisted: await s.stored(), crop: sha(tap) });
  await s.click('settingsControls', 'controls');
  report.steps.push({ step: 'desktop, back to the default scheme', persisted: await s.stored() });

  stitchV([before, withPad, afterPad, tap], join(OUT, 'u8-desktop-controls-row.png'));
  report.desktopErrors = s.errs;
  await context.close();
}

// --- PHONE: a touch profile, held landscape --------------------------------
{
  const context = await browser.newContext({
    viewport: { width: 844, height: 390 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
  });
  const s = await openSettings(context);
  const row = await s.shotRow('phone-1-sticks');
  await s.shotFull('u8-phone-settings-sticks');
  writeFileSync(join(OUT, 'u8-phone-controls-row.png'), readFileSync(row));
  report.steps.push({ step: 'phone (touch), no pad', persisted: await s.stored(), crop: sha(row) });

  // A pad plugged into a phone must NOT take the word away from the sticks the
  // player can see on the glass.
  await setPad(s.page, true);
  await sleep(300);
  const padRow = await s.shotRow('phone-2-sticks-with-pad');
  report.steps.push({ step: 'phone (touch), pad connected', persisted: await s.stored(), crop: sha(padRow) });
  report.touchUnaffectedByPad = sha(row) === sha(padRow);
  report.phoneErrors = s.errs;
  await context.close();
}

await browser.close();
writeFileSync(join(OUT, 'u8-controls-label.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
