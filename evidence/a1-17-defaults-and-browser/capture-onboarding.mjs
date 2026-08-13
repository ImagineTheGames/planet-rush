/**
 * evidence/a1-17-defaults-and-browser/capture-onboarding.mjs — THE FIRST
 * TUTORIAL SENTENCE, on a REAL solo match on the SERVED build, plus the strip
 * drawn directly under it. OWNER: QA Manager (a1-17 §2; a0-33 / #404 over
 * a0-30 / #399).
 *
 * The claim under test is one sentence long: under the new defaults the first
 * prompt must NOT tell the player to *hold fire*, because Tap Commander mines by
 * tapping the rock and the weapon aims itself. This is the developer's own
 * report, so the standard is the developer's: **read the words a player reads.**
 *
 * ── WHY THE SHIP HAS TO BE FLOWN ────────────────────────────────────────────
 * A first pass photographed eight frames of an idle match and found NO prompt at
 * all — correct behaviour, and no evidence. MINE's trigger is `nearAsteroid`
 * (`src/ui/onboarding.ts`) and a ship parked at its own station has no rock in
 * weapon range. So the ship is FLOWN, by the gesture the scheme under test
 * actually gives the player. Nothing is staged: no seam moves the ship, and no
 * seam grants cargo — `__oreHudStage.mine()` would set `hasMined` and RETIRE the
 * very prompt this is about.
 *
 * ── ONE INSTRUMENT ARTEFACT, CAUGHT AND REMOVED ─────────────────────────────
 * The first pass drove EVERY sticks profile with the keyboard, including the
 * phone, and duly photographed a handset being told to *"Hold Left mouse"*. That
 * would have been a fabricated finding: the HUD re-resolves bindings for
 * whatever device last supplied input (`activeDevice`), so a keyboard press had
 * turned the phone into a keyboard. Touch profiles are now driven by touch only,
 * and `device()` is read in the SAME evaluate as the text, never before it.
 *
 * ── TWO INDEPENDENT READS, AND THEY HAVE TO AGREE ───────────────────────────
 *  A. `?debug=1` + `__onboardingStage`, reporting `prompt()`, `device()` and
 *     `scheme()` atomically, plus `__upgradeWheelStage.legend()` — the controls
 *     strip the same frame resolved.
 *  B. THE CLEAN BOOT — no `?debug=1`, so no seam exists to read a string off.
 *     The client is walked in through the front door (PLAY → PLAY SOLO → RUSH!),
 *     every press landing on the physical point the client itself reported
 *     drawing that control at, the ship flown the same way, and the bottom band
 *     photographed and zoomed 3x NEAREST-NEIGHBOUR. The words are then read OFF
 *     THE PIXELS by eye. This is the primary evidence: it is what a player sees.
 *     If A and B disagree, B wins and the disagreement is itself the finding.
 *
 * ── THE THIRD SECTION: DOES THE STRIP TELL THE TRUTH? ───────────────────────
 * The strip is drawn one line under the prompt and `describeBindings(device,
 * mode)` takes no scheme at all. Whether "WASD Thrust" is a lie or merely
 * incomplete on a Tap Commander seat is a question about the SHIP, so it is
 * answered by pressing W and measuring whether the ship moves — never by
 * reading the code.
 *
 *   node evidence/a1-17-defaults-and-browser/capture-onboarding.mjs
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const IMAGES = resolve(HERE, '..', 'images');
const BASE = process.env.A1_17_BASE_URL ?? 'https://imaginethegames.github.io/planet-rush/';
const SCHEME_KEY = 'planet-rush:controlScheme';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync(IMAGES, { recursive: true });

/** The three form factors, spelled as explicit viewports rather than device
 *  presets — `devices['Pixel 7 landscape']` is 863x360 and this brief asks for
 *  390 px, which is a different screen. */
const DESKTOP = { viewport: { width: 1280, height: 800 }, touch: false };
const PHONE_L = { viewport: { width: 844, height: 390 }, touch: true };
const PHONE_P = { viewport: { width: 390, height: 844 }, touch: true };

const PROFILES = [
  { id: 'desktop-fresh', ...DESKTOP, stored: {} },
  { id: 'phone844x390-fresh', ...PHONE_L, stored: {} },
  { id: 'phone390x844-fresh', ...PHONE_P, stored: {} },
  { id: 'desktop-saved-sticks', ...DESKTOP, stored: { [SCHEME_KEY]: 'sticks' } },
  { id: 'phone844x390-saved-sticks', ...PHONE_L, stored: { [SCHEME_KEY]: 'sticks' } },
];

const out = { base: BASE, capturedAt: new Date().toISOString(), debugSeam: {}, cleanBoot: {}, thrustProbe: {} };

/** Nearest-neighbour zoom: every output pixel is a pixel the client drew,
 *  repeated. Nothing interpolated, so the instrument cannot invent a glyph or
 *  smooth one away. */
function zoomCrop(srcPath, rect, factor, dstPath) {
  const src = PNG.sync.read(readFileSync(srcPath));
  const x0 = Math.max(0, Math.floor(rect.x));
  const y0 = Math.max(0, Math.floor(rect.y));
  const w = Math.max(1, Math.min(Math.ceil(rect.width), src.width - x0));
  const h = Math.max(1, Math.min(Math.ceil(rect.height), src.height - y0));
  const dst = new PNG({ width: w * factor, height: h * factor });
  for (let y = 0; y < h * factor; y += 1) {
    for (let x = 0; x < w * factor; x += 1) {
      const si = (src.width * (y0 + Math.floor(y / factor)) + (x0 + Math.floor(x / factor))) << 2;
      const di = (dst.width * y + x) << 2;
      dst.data[di] = src.data[si];
      dst.data[di + 1] = src.data[si + 1];
      dst.data[di + 2] = src.data[si + 2];
      dst.data[di + 3] = 255;
    }
  }
  writeFileSync(dstPath, PNG.sync.write(dst));
  return { x: x0, y: y0, width: w, height: h, factor };
}

/** The bottom band of the frame — where the prompt and the controls strip both
 *  live. Cropping them TOGETHER is deliberate: what one says about the other is
 *  the point. */
const bandRect = (vp) => ({ x: 0, y: Math.round(vp.height * 0.86), width: vp.width, height: Math.round(vp.height * 0.14) });

/**
 * Fly the ship by REAL input until `done()` returns something, or the clock runs
 * out. Tap Commander flies to a tapped point; a sticks player on a keyboard
 * thrusts on W; a sticks player on a handset drags the left virtual stick. No
 * seam writes the ship's position in any of the three.
 */
async function flyUntil(page, { touch, scheme }, done, budgetMs = 70_000) {
  const box = await page.locator('canvas').boundingBox();
  const targets = [
    { fx: 0.18, fy: 0.35 }, { fx: 0.16, fy: 0.68 }, { fx: 0.32, fy: 0.18 },
    { fx: 0.78, fy: 0.30 }, { fx: 0.82, fy: 0.74 }, { fx: 0.32, fy: 0.84 },
    { fx: 0.10, fy: 0.50 }, { fx: 0.68, fy: 0.14 },
  ];
  const started = Date.now();
  let inputs = 0;
  while (Date.now() - started < budgetMs) {
    const hit = await done();
    if (hit) return { hit, flownForMs: Date.now() - started, inputs };
    const t = targets[inputs % targets.length];
    const p = { x: box.x + box.width * t.fx, y: box.y + box.height * t.fy };
    if (scheme === 'tap') {
      if (touch) await page.touchscreen.tap(p.x, p.y);
      else await page.mouse.click(p.x, p.y);
    } else if (touch) {
      // The left virtual stick sits in the lower-left of the touch layout; a
      // drag out of its centre is a held thrust in that direction.
      const o = { x: box.x + box.width * 0.16, y: box.y + box.height * 0.72 };
      const dir = targets[inputs % targets.length];
      await page.touchscreen.tap(o.x, o.y); // wake the stick
      const client = await page.context().newCDPSession(page);
      const drag = { x: o.x + (dir.fx - 0.5) * 120, y: o.y + (dir.fy - 0.5) * 120 };
      await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: o.x, y: o.y }] });
      await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: drag.x, y: drag.y }] });
      await sleep(1800);
      await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await client.detach();
    } else {
      const keys = ['KeyW', inputs % 2 === 0 ? 'KeyA' : 'KeyD'];
      for (const k of keys) await page.keyboard.down(k);
      await sleep(1500);
      for (const k of keys) await page.keyboard.up(k);
    }
    inputs += 1;
    await sleep(1500);
    const late = await done();
    if (late) return { hit: late, flownForMs: Date.now() - started, inputs };
  }
  return { hit: null, flownForMs: Date.now() - started, inputs };
}

const newPage = async (browser, p, query = '') => {
  const ctx = await browser.newContext({
    viewport: p.viewport,
    hasTouch: p.touch,
    isMobile: false,
    deviceScaleFactor: 1,
  });
  const page = await ctx.newPage();
  await page.addInitScript((entries) => {
    localStorage.clear();
    for (const [k, v] of entries) localStorage.setItem(k, v);
  }, Object.entries(p.stored));
  await page.goto(`${BASE}${query}`, { waitUntil: 'load' });
  await page.waitForSelector('canvas', { state: 'attached', timeout: 60_000 });
  return { ctx, page };
};

const browser = await chromium.launch();

// ---------------------------------------------------------------------------
// A. ?debug=1 — the sentence, its device, its scheme, and the strip beside it.
// ---------------------------------------------------------------------------
for (const p of PROFILES) {
  const { ctx, page } = await newPage(browser, p, '?debug=1');
  await page.waitForFunction(() => typeof window.__onboardingStage?.prompt === 'function', undefined, { timeout: 40_000 });

  const scheme = await page.evaluate(() => window.__onboardingStage.scheme());
  const sha = await page.evaluate(() => window.__planetRush?.build?.sha ?? null);

  /** Text, device and scheme in ONE evaluate — the artefact above is exactly what
   *  reading them apart produces. `visible` is required: a hidden group can still
   *  be holding the previous frame's string. */
  const read = () =>
    page.evaluate(() => {
      const st = window.__onboardingStage;
      const pr = st.prompt();
      if (!pr || !pr.visible || !pr.text) return null;
      return {
        text: pr.text,
        width: pr.width,
        height: pr.height,
        wrapWidth: pr.wrapWidth,
        device: st.device(),
        scheme: st.scheme(),
        legend: (window.__upgradeWheelStage?.legend?.() ?? []).map((r) => ({ ...r })),
      };
    });

  const flight = await flyUntil(page, { touch: p.touch, scheme }, read);
  const shot = join(IMAGES, `a1-17-prompt-debug-${p.id}.png`);
  await page.screenshot({ path: shot });
  const rect = bandRect(p.viewport);
  const zoom = zoomCrop(shot, rect, 3, join(IMAGES, `a1-17-prompt-debug-${p.id}-band.png`));

  out.debugSeam[p.id] = {
    stored: p.stored,
    buildSha: sha,
    viewport: p.viewport,
    schemeAtBoot: scheme,
    prompt: flight.hit,
    flownForMs: flight.flownForMs,
    inputs: flight.inputs,
    image: `images/a1-17-prompt-debug-${p.id}.png`,
    band: `images/a1-17-prompt-debug-${p.id}-band.png`,
    bandRect: zoom,
  };
  console.log(
    `debug ${p.id.padEnd(26)} scheme=${scheme} device=${flight.hit?.device ?? '?'}  "${flight.hit?.text ?? 'NO PROMPT'}"  (${(flight.flownForMs / 1000).toFixed(0)}s)`,
  );
  if (flight.hit?.legend?.length) {
    console.log(`      strip: ${flight.hit.legend.map((r) => `${r.binding ?? ''} ${r.label ?? ''}`.trim()).join('  |  ')}`);
  }
  await ctx.close();
}

// ---------------------------------------------------------------------------
// B. THE CLEAN BOOT — front door all the way in, no text seam anywhere.
// ---------------------------------------------------------------------------
async function press(page, seam, kind, touch) {
  const box = await page.locator('canvas').boundingBox();
  const at = await page.evaluate(
    ({ seam, kind }) => {
      const list = seam === 'menu' ? window.__mainMenu?.controls : window.__onlineMenu?.doorControls;
      const c = (list ?? []).find((x) => x.kind === kind);
      return c ? { x: c.physicalCenter.x, y: c.physicalCenter.y } : null;
    },
    { seam, kind },
  );
  if (!at) throw new Error(`no ${seam} control of kind ${kind}`);
  const q = { x: box.x + at.x, y: box.y + at.y };
  if (touch) await page.touchscreen.tap(q.x, q.y);
  else await page.mouse.click(q.x, q.y);
  return q;
}

for (const p of PROFILES) {
  const { ctx, page } = await newPage(browser, p);
  await page.waitForFunction(() => typeof window.__mainMenu?.screen === 'string', undefined, { timeout: 40_000 });

  const record = { stored: p.stored, viewport: p.viewport, presses: {} };
  record.presses.play = await press(page, 'menu', 'play', p.touch);
  await page.waitForFunction(() => window.__onlineMenu?.visible === true, undefined, { timeout: 20_000 });
  record.presses.solo = await press(page, 'doors', 'solo', p.touch);
  await page.waitForFunction(() => window.__lobby?.visible === true, undefined, { timeout: 20_000 });
  await sleep(600);
  {
    const box = await page.locator('canvas').boundingBox();
    const at = await page.evaluate(() => window.__lobby?.rushControl?.physicalCenter ?? null);
    const q = { x: box.x + at.x, y: box.y + at.y };
    if (p.touch) await page.touchscreen.tap(q.x, q.y);
    else await page.mouse.click(q.x, q.y);
    record.presses.rush = q;
  }
  await page.waitForFunction(() => window.__mainMenu?.matchStarted === true, undefined, { timeout: 60_000 });
  record.menuControlScheme = await page.evaluate(() => window.__mainMenu?.controlScheme ?? null);
  record.matchControlScheme = await page.evaluate(() => window.__mainMenu?.matchControlScheme ?? null);

  // The stop condition is PIXELS: bright glyph pixels appearing in the band.
  const rect = bandRect(p.viewport);
  const probe = join(IMAGES, `_probe-${p.id}.png`);
  const baselineLit = await (async () => {
    await page.screenshot({ path: probe });
    return countLit(probe, rect);
  })();
  const bandLit = async () => {
    await page.screenshot({ path: probe });
    const lit = countLit(probe, rect);
    return lit > baselineLit + 180 ? { lit, baselineLit } : null;
  };

  const flight = await flyUntil(page, { touch: p.touch, scheme: record.matchControlScheme }, bandLit);
  const shot = join(IMAGES, `a1-17-prompt-clean-${p.id}.png`);
  await page.screenshot({ path: shot });
  const zoom = zoomCrop(shot, rect, 3, join(IMAGES, `a1-17-prompt-clean-${p.id}-band.png`));

  record.litPixels = flight.hit?.lit ?? null;
  record.baselineLitPixels = baselineLit;
  record.flownForMs = flight.flownForMs;
  record.inputs = flight.inputs;
  record.image = `images/a1-17-prompt-clean-${p.id}.png`;
  record.band = `images/a1-17-prompt-clean-${p.id}-band.png`;
  record.bandRect = zoom;
  out.cleanBoot[p.id] = record;
  console.log(`clean ${p.id.padEnd(26)} menu=${record.menuControlScheme} match=${record.matchControlScheme}  lit=${record.litPixels}/${baselineLit}  (${(flight.flownForMs / 1000).toFixed(0)}s)`);
  await ctx.close();
}

function countLit(path, rect) {
  const png = PNG.sync.read(readFileSync(path));
  let lit = 0;
  const x0 = Math.max(0, Math.floor(rect.x));
  const y0 = Math.max(0, Math.floor(rect.y));
  const w = Math.min(Math.ceil(rect.width), png.width - x0);
  const h = Math.min(Math.ceil(rect.height), png.height - y0);
  for (let y = y0; y < y0 + h; y += 1) {
    for (let x = x0; x < x0 + w; x += 1) {
      const i = (png.width * y + x) << 2;
      if (png.data[i] > 150 && png.data[i + 1] > 150 && png.data[i + 2] > 150) lit += 1;
    }
  }
  return lit;
}

// ---------------------------------------------------------------------------
// C. THE STRIP'S CLAIM, MEASURED — does W move a Tap Commander ship?
// ---------------------------------------------------------------------------
for (const stored of [{}, { [SCHEME_KEY]: 'sticks' }]) {
  const id = stored[SCHEME_KEY] ?? 'fresh-default';
  const { ctx, page } = await newPage(browser, { ...DESKTOP, stored });
  await page.waitForFunction(() => typeof window.__mainMenu?.screen === 'string', undefined, { timeout: 40_000 });
  await press(page, 'menu', 'play', false);
  await page.waitForFunction(() => window.__onlineMenu?.visible === true, undefined, { timeout: 20_000 });
  await press(page, 'doors', 'solo', false);
  await page.waitForFunction(() => window.__lobby?.visible === true, undefined, { timeout: 20_000 });
  await sleep(600);
  {
    const box = await page.locator('canvas').boundingBox();
    const at = await page.evaluate(() => window.__lobby.rushControl.physicalCenter);
    await page.mouse.click(box.x + at.x, box.y + at.y);
  }
  await page.waitForFunction(() => window.__mainMenu?.matchStarted === true, undefined, { timeout: 60_000 });
  await page.waitForFunction(() => window.__mainMenu?.localShipPos !== null, undefined, { timeout: 20_000 });
  await sleep(1500);

  const pos = () => page.evaluate(() => ({ ...window.__mainMenu.localShipPos }));
  const drift = async (ms) => {
    const a = await pos();
    await sleep(ms);
    const b = await pos();
    return { a, b, dist: Math.hypot(b.x - a.x, b.y - a.y) };
  };
  // Idle drift first: the ship is not necessarily still, so W has to beat this.
  const idle = await drift(3000);
  await page.keyboard.down('KeyW');
  const held = await drift(3000);
  await page.keyboard.up('KeyW');
  await sleep(1500);
  // And the scheme's own gesture, for scale.
  const box = await page.locator('canvas').boundingBox();
  const before = await pos();
  await page.mouse.click(box.x + box.width * 0.2, box.y + box.height * 0.3);
  await sleep(3000);
  const afterTap = await pos();

  out.thrustProbe[id] = {
    stored,
    scheme: await page.evaluate(() => window.__mainMenu.matchControlScheme),
    idleDrift3s: idle,
    wHeld3s: held,
    tapFly3s: { before, after: afterTap, dist: Math.hypot(afterTap.x - before.x, afterTap.y - before.y) },
  };
  console.log(
    `thrust ${id}: idle ${idle.dist.toFixed(1)}  W-held ${held.dist.toFixed(1)}  tap ${out.thrustProbe[id].tapFly3s.dist.toFixed(1)} (world units / 3 s)`,
  );
  await ctx.close();
}

await browser.close();
writeFileSync(join(HERE, 'readback-onboarding.json'), JSON.stringify(out, null, 2));
console.log('wrote readback-onboarding.json');
