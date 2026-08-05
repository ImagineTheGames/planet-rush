/**
 * evidence/capture-u5-slot-state.mjs — u5-01 the seat-state affordance.
 *
 * WHAT IT PROVES: that a player looking at the lobby can now SEE that a slot can
 * be closed. The developer reported the opposite by looking at it — *"theres no
 * way visible way to know that you can close slots right now"* — so the proof has
 * to be lookable in the same way, on the same screens.
 *
 * It reaches the lobby the way a player does — a real click / a real touch on
 * PLAY, then PLAY SOLO — rather than by calling a seam, so the shot is of the
 * screen a player actually gets. Each profile is shot twice:
 *
 *   1. `-open`   — the lobby as it opens. BEFORE this brief every row here was a
 *                  name and two chips, with nothing saying the row was pressable
 *                  at all; AFTER, every row leads with a labelled `OPEN` button.
 *   2. `-closed` — after two real presses on ONE row's state control, so a
 *                  `CLOSED` row is on screen beside seven that are not, and the
 *                  RUSH! hint under the button reads one player fewer.
 *
 * Run it against the pre-u5 build and the post-u5 build (`EVIDENCE_LABEL`) to get
 * the before/after pair; the second press is a no-op on the "before" build, where
 * the control does not exist, so that pair is itself the report.
 *
 * Usage:
 *   npm run build && npx vite preview --port 4173 --strictPort &
 *   EVIDENCE_LABEL=after node evidence/capture-u5-slot-state.mjs
 */
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'images');
const BASE = process.env.EVIDENCE_BASE_URL ?? 'http://localhost:4173';
const LABEL = process.env.EVIDENCE_LABEL ?? 'after';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

mkdirSync(OUT, { recursive: true });

/** QA's own device profiles plus the pointer control. Portrait is included
 *  deliberately: the game locks to landscape, so a portrait-HELD phone renders
 *  the rotated canvas, and that is the state the developer holds the phone in. */
const PROFILES = [
  { id: 'desktop', viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, touch: false },
  { id: 'iphone-landscape', viewport: { width: 844, height: 390 }, deviceScaleFactor: 3, touch: true },
  { id: 'iphone-portrait', viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, touch: true },
  { id: 'pixel-landscape', viewport: { width: 915, height: 412 }, deviceScaleFactor: 2.6, touch: true },
];

const browser = await chromium.launch({
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});

const report = { capture: 'u5-slot-state-affordance', label: LABEL, base: BASE, profiles: [] };

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
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  const press = async (x, y) => {
    if (profile.touch) await page.touchscreen.tap(x, y);
    else await page.mouse.click(x, y);
    await sleep(400);
  };

  await page.goto(BASE, { waitUntil: 'load', timeout: 60_000 });
  await page.waitForSelector('canvas', { state: 'attached', timeout: 30_000 });
  await page.waitForFunction(() => window.__mainMenu?.visible === true, undefined, { timeout: 30_000 });
  await page.evaluate(() => document.fonts?.ready).catch(() => {});

  // PLAY → the doors → PLAY SOLO → the lobby.
  const play = await page.evaluate(() =>
    (window.__mainMenu.controls ?? []).find((c) => c.kind === 'play')?.physicalCenter ?? null,
  );
  await press(play.x, play.y);
  await page.waitForFunction(
    () => window.__onlineMenu?.visible === true && (window.__onlineMenu.doorControls ?? []).length > 0,
    undefined,
    { timeout: 30_000 },
  );
  const solo = await page.evaluate(() =>
    (window.__onlineMenu.doorControls ?? []).find((c) => c.kind === 'solo')?.physicalCenter ?? null,
  );
  await press(solo.x, solo.y);
  await page.waitForFunction(() => window.__lobby?.visible === true, undefined, { timeout: 30_000 });
  await sleep(700);

  const opened = join(OUT, `u5-slot-state-${LABEL}-${profile.id}-open.png`);
  await page.screenshot({ path: opened });

  // The seam reports the controls it drew — absent entirely on the pre-u5 build,
  // which is the finding rather than an error. Fall back to the ROW's own centre
  // there, so the "before" shot still shows what the same two presses produced on
  // the build the developer was looking at.
  const seam = await page.evaluate(() => ({
    size: window.__lobby.size,
    isTouch: window.__lobby.isTouch,
    viewport: window.__lobby.logicalViewport,
    states: (window.__lobby.seatStates ?? []).map((c) => ({
      index: c.index,
      label: c.label,
      live: c.live,
      logical: { ...c.logical },
      physicalCenter: { ...c.physicalCenter },
    })),
    rows: (window.__lobby.seatRows ?? []).map((r) => ({ ...r })),
  }));

  // Row 1 — the first seat that is not yours, so the cycle is live on it.
  const control = seam.states.find((c) => c.index === 1 && c.live);
  let point = control?.physicalCenter ?? null;
  if (!point) {
    // Pre-u5: no control exists. Press the row body — which is what the developer
    // could not know to do — using the row rect if the build reports one.
    const row = seam.rows[1];
    point = row ? { x: row.x + row.width * 0.2, y: row.y + row.height / 2 } : null;
  }

  let after = null;
  let closed = null;
  if (point) {
    await press(point.x, point.y); // OPEN → BOT
    await press(point.x, point.y); // BOT  → CLOSED
    after = await page.evaluate(() => ({
      size: window.__lobby.size,
      labels: (window.__lobby.seatStates ?? []).map((c) => c.label),
    }));
    closed = join(OUT, `u5-slot-state-${LABEL}-${profile.id}-closed.png`);
    await page.screenshot({ path: closed });
  }
  // No second shot where there was nothing to press. On the pre-u5 build the
  // screen reports no control and no row rect, so the honest artifact is the one
  // frame — a lobby with nothing on it that says a slot can be closed — rather
  // than a duplicate of it captioned as an "after".

  report.profiles.push({
    id: profile.id,
    viewport: profile.viewport,
    deviceScaleFactor: profile.deviceScaleFactor,
    input: profile.touch ? 'touch' : 'pointer',
    orientation: profile.viewport.width >= profile.viewport.height ? 'landscape' : 'portrait-held',
    lobbyIsTouch: seam.isTouch,
    logicalViewport: seam.viewport,
    /** How many rows drew a state control. 0 on the pre-u5 build — the defect. */
    stateControlsDrawn: seam.states.length,
    stateLabelsOnOpen: seam.states.map((c) => c.label),
    stateControlRect: control?.logical ?? null,
    sizeBefore: seam.size,
    sizeAfterTwoPresses: after?.size ?? null,
    labelsAfterTwoPresses: after?.labels ?? null,
    images: [opened, closed].filter(Boolean).map((p) => p.replace(HERE + '/', '')),
    consoleErrors: errors,
  });

  await ctx.close();
  console.log(
    `${profile.id}: ${seam.states.length} state controls drawn; N ${seam.size} → ${after?.size ?? '—'}; ${errors.length} errors`,
  );
}

await browser.close();
const path = join(OUT, `u5-slot-state-${LABEL}.json`);
writeFileSync(path, JSON.stringify(report, null, 2));
console.log(`\nwrote ${path}`);
