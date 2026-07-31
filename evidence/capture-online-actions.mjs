/**
 * evidence/capture-online-actions.mjs — GATES `online-actions` and `online-feel`,
 * from ONE live two-client match. OWNER: QA Manager.
 *
 * The three symptoms the developer reported from a mobile playtest —
 *
 *   "Shooting produces 2 sets of shots; my health went down then back up after
 *    taking damage; turrets built instantly and I built 2 but 3 got built."
 *
 * — are DISCRETE events. A per-second average of thirty reconciles is the wrong
 * instrument for any of them, so this drives two shipped clients through the real
 * front door into one live room and then stages the three moments deliberately.
 *
 * WHAT THIS RUN CAN AND CANNOT READ, ESTABLISHED BY RUNNING IT.
 * The first draft asked the deployed client for both the real front door and the
 * `?debug=1` live-stage seams (`__tapCommanderStage.buildReadout()`,
 * `__healthbarStage.hullReadout()`, `__planetRush.shipWorld`). THE DEPLOYED BUILD
 * CANNOT GIVE BOTH, and it says so in its own source: `src/main.ts:696` builds the
 * menu only when `flags.debug` is FALSE, and the lobby the same way at :731 —
 * `?debug=1` *skips* the menu and the lobby, which is the harness contract. So
 * under `?debug=1` there is no PLAY, no CREATE ROOM, and no online match to
 * measure. Enumerated on the deployed ef4babe client:
 *
 *   clean boot → __buildBadge __mainMenu __onlineMenu __lobby __fullscreen
 *   ?debug=1   → __buildBadge __planetRush __healthbarStage __tapCommanderStage
 *                __oreHudStage __pressStage __repairStage __minimapStage …
 *
 * A gate about a LIVE two-client match must take the first column. So NOTHING
 * numeric is read out of the running match here. What stands in for it is what
 * the game hands the player anyway, and both are stronger evidence than a seam:
 *
 *   THE PIXELS — every stage is photographed on BOTH screens and read by eye.
 *   THE COPY LOG EXPORT — whose action events (src/net/action-journal.ts) are
 *   precisely the discrete record the three symptoms are about:
 *     `volley` carries `inFlight`, the firer's own predicted shots alive — the
 *        number that read 5 on a screen whose sim held 2;
 *     `order` is one build the player asked for, with its id and item;
 *     `echo`  is authority's answer to that id — `adopt`, or the two mismatches
 *        `refused` / `unknown`, which is what "I built 2 and 3 appeared" is;
 *     `expiry` is an order predicted and never answered — a turret taken back.
 *   Two taps that yield three turrets cannot happen without leaving a mark in
 *   those four lines, and neither can a volley drawn twice.
 *
 * THE PHASES, IN ORDER.
 *   BUILD #1 — at SPAWN, where the ship is docked at its own station and nowhere
 *            else is guaranteed. E, then two real clicks on the drawn TURRET wedge
 *            ~1.5 s apart, then the station photographed at +2 s, +6 s, +13 s and
 *            +20 s. `STARTING_ORE` is 3 and `TURRET.cost` is 3, so the honest
 *            expectation is ONE turret and one REFUSAL — and the refusal is the
 *            sensitive half: "I built 2 but 3 got built" is a client inventing an
 *            order authority never agreed to. A turret must also NOT be standing
 *            there at +2 s (`TURRET.buildTime` is 10 s, `src/sim/constants.ts`).
 *   MINE   — trigger held, AUTO-AIM on, short bursts out into the rock field with
 *            a STEERED return between them. Both halves are needed and both were
 *            measured: no thrust at all banks nothing, and thrust in any fixed
 *            pattern loses the station for good. See `mineNearHome`.
 *   BUILD #2 — the same two taps again once there is ore, retried up to four times
 *            with a re-home between tries. Whether the wheel opened is MEASURED
 *            (`wheelIsOpen`), not assumed, and recorded either way.
 *   VOLLEY — everything stops, the host presses fire ONCE (90 ms — one shot at
 *            `SHIP_WEAPON.fireInterval` 0.35 s) and both screens are photographed.
 *            NOTE, from running it: a shot's life is shorter than a screenshot
 *            round trip here (first frame lands ~650 ms after the trigger, by which
 *            time the shot is gone), so these frames do NOT count shots. The count
 *            that does is the log's own `volley` line and its `inFlight`.
 *   FIGHT  — trigger held with AUTO-AIM (which takes enemies before rocks) while a
 *            burst of tightly-clipped frames is taken around screen centre, where
 *            the camera holds the ship and draws its hull bar. ALSO WEAK, and for
 *            the same reason: a burst only catches a yo-yo by luck, and in these
 *            runs the ships were rarely damaged inside the window. The hull claim
 *            is carried by `respawn-tail.live.test.ts`, which reads the predicted
 *            world's hull before EVERY reconcile.
 *   CRUISE — both fly straight, weapons cold, for the last ~40 s before the log is
 *            taken, so the FINAL samples of the export are steady-state flight —
 *            the condition `docs/netcode-tick-alignment.md` §4 quotes 0.06/0.14 u
 *            against, and the one the developer's 0.3–0.6 u report was taken in.
 *
 * A WARNING TO WHOEVER RUNS THIS NEXT. The screenshots in the phases above STALL
 * THE PAGE, and a stalled page is not sending input while authority keeps
 * simulating. Every screenshot-heavy run here produced a 5–6 s window at a large
 * constant correction that looks exactly like a netcode defect and is not one —
 * `evidence/probe-feel-control.mjs` is the same match with the camera off and it
 * has zero breaching seconds. Score `online-feel` from the CONTROL, not from this.
 *
 * Then the log is taken the way a player takes it: pause, press COPY LOG, keep
 * what it put on the clipboard. `score-feel-log.mjs` scores it.
 *
 * Every press is a real mouse click or key at the physical point the client
 * reports drawing the control at. The one setting changed is FIRE MODE → AUTO-AIM,
 * through the real SETTINGS screen, because a headless run cannot see where the
 * rocks are and the second turret has to be mined for. It is the shipped default
 * on touch.
 *
 * Usage:
 *   node evidence/capture-online-actions.mjs [tag] [attempts]
 *   EVIDENCE_BASE_URL=... to point at something other than the deployed client.
 */
import { chromium } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'images');
mkdirSync(OUT, { recursive: true });

/** CLEAN BOOT — no `?debug=1`. See the header: it would remove the front door. */
const BASE = process.env.EVIDENCE_BASE_URL ?? 'https://imaginethegames.github.io/planet-rush/';
const PC = { name: 'pc', width: 1280, height: 800, dpr: 1, touch: false };

/**
 * How long to mine. THIRTY-THREE SECONDS, and the number is the whole trick.
 *
 * Two turrets cost 6 and the spawn bank is 3, so 3 must be mined, and the Build
 * wheel only opens near the player's own station. Those two requirements pull
 * against each other, because thrusting is the only way to mine and thrusting is
 * what loses the station. Three rounds of measurement bracket it:
 *
 *   sit still, no thrust, 120 s → still docked, and TOTAL still 3. Nothing comes
 *     into range on its own (images/dock-mining-t120s.png). Mining needs motion.
 *   thrust for 60–150 s → 6 to 9 ore, and the station is 400+ px away with the
 *     wheel refusing "get closer to your station"
 *     (images/online-actions-c1-host-wheel-open.png — the frame that names the
 *     defect in my own instrument, not the game's).
 *   thrust for 30 s → TOTAL already 6, and the ship is still ALONGSIDE its
 *     station. (That round's frames were pruned before the PR; the surviving
 *     equivalent is images/online-actions-c1-host-mining-t120s.png, which shows the
 *     OTHER end of the same trade — TOTAL 9 and the station far out of range.)
 *
 * So the window where both are true is the first half-minute, and this sits in it.
 */
const MINE_MS = Number(process.env.QA_MINE_MS ?? 33_000);
/** How long the two ships hold the trigger for the hull window. */
const FIGHT_MS = Number(process.env.QA_FIGHT_MS ?? 30_000);
/** Straight-line cruise, weapons cold, immediately before the log is taken. */
const CRUISE_MS = Number(process.env.QA_CRUISE_MS ?? 44_000);
/** One turret: `TURRET.cost` 3 ore, `TURRET.buildTime` 10 s (src/sim/constants.ts). */
const TURRET_COST = 3;
const TURRET_BUILD_S = 10;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => Date.now();

// ---------------------------------------------------------------------------
// Booting a client, and the front door
// ---------------------------------------------------------------------------

async function bootClient(browser, profile, who) {
  const context = await browser.newContext({
    viewport: { width: profile.width, height: profile.height },
    deviceScaleFactor: profile.dpr,
    hasTouch: profile.touch,
    isMobile: profile.touch,
    permissions: ['clipboard-read', 'clipboard-write'],
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(BASE, { waitUntil: 'load', timeout: 60_000 });
  await page.waitForSelector('canvas', { state: 'attached', timeout: 60_000 });
  await page.waitForFunction(() => window.__mainMenu?.visible === true, undefined, { timeout: 60_000 });
  const box = await page.locator('canvas').boundingBox();
  if (!box) throw new Error('no canvas bounding box');
  const press = async (p) => {
    await page.mouse.click(box.x + p.x, box.y + p.y);
  };
  return { who, profile, page, context, press, errors, box };
}

const menuPoint = (page, kind) =>
  page.evaluate((k) => {
    const c = (window.__mainMenu?.controls ?? []).find((x) => x.kind === k);
    return c ? { x: c.physicalCenter.x, y: c.physicalCenter.y } : null;
  }, kind);
const settingsPoint = (page, kind) =>
  page.evaluate((k) => {
    const c = (window.__mainMenu?.settingsControls ?? []).find((x) => x.kind === k);
    return c ? { x: c.physicalCenter.x, y: c.physicalCenter.y } : null;
  }, kind);
const doorPoint = (page, kind) =>
  page.evaluate((k) => {
    const c = (window.__onlineMenu?.doorControls ?? []).find((x) => x.kind === k);
    return c ? { x: c.physicalCenter.x, y: c.physicalCenter.y } : null;
  }, kind);

async function pressDoor(client, kind) {
  const p = await doorPoint(client.page, kind);
  if (!p) throw new Error(`the entry screen reported no '${kind}' control`);
  await client.press(p);
}
async function pressPlay(client) {
  const p = await menuPoint(client.page, 'play');
  if (!p) throw new Error('the menu reported no PLAY button');
  await client.press(p);
  await client.page.waitForFunction(() => window.__onlineMenu?.visible === true, undefined, { timeout: 30_000 });
}

const shot = (client, tag, name, opts) =>
  client.page.screenshot({ path: join(OUT, `online-actions-${tag}-${client.who}-${name}.png`), ...(opts ?? {}) }).catch(() => {});

/**
 * STILL ON THE WIRE? The build badge's suffix IS the live session — `__buildBadge`
 * reads `'ef4babe'` alone with no session and `'ef4babe · d891dd0a (gru)'` with
 * one (src/main.ts:6827), and it is on a clean boot, which the match seams are
 * not. It is the only connection read-back this round has, and it is needed:
 * attempt b1 lost the host to a `join-rejected` mid-match and the phases after it
 * were measuring a client that was no longer in the room.
 */
const wireState = (client) =>
  client.page
    .evaluate(() => ({
      badge: window.__buildBadge?.text ?? null,
      server: window.__buildBadge?.server ?? null,
      // The shipped disconnect notice, if the game has put one up.
      copyLogOffered: !!document.querySelector('#playtest-copy-log-button'),
    }))
    .catch(() => null);

/**
 * Set FIRE MODE to AUTO-AIM through the real SETTINGS screen, and photograph the
 * row that says so. Declared plainly because it is the one thing this run changes
 * about how the game plays.
 */
async function setAutoAim(client, tag) {
  const p = await menuPoint(client.page, 'settings');
  if (!p) throw new Error('the menu reported no SETTINGS button');
  await client.press(p);
  await client.page.waitForFunction(() => window.__mainMenu?.screen === 'settings', undefined, { timeout: 20_000 });
  const row = await settingsPoint(client.page, 'fireMode');
  if (!row) throw new Error('the settings screen reported no FIRE MODE row');
  // The row is a toggle and the seam reports no value, so the FRAME is the record
  // of what it ended up on — and it is kept either way.
  await client.press(row);
  await sleep(400);
  await shot(client, tag, 'settings-fire');
  const back = await settingsPoint(client.page, 'back');
  if (back) await client.press(back);
  await client.page.waitForFunction(() => window.__mainMenu?.screen === 'menu', undefined, { timeout: 20_000 });
}

/** Reload and re-walk a door until the lobby comes up (the live machine-pin can
 *  refuse a ticketed upgrade, and the shipped client offers no RETRY). */
async function reachLobby(client, what, walkDoor, tries = 8) {
  const stalls = [];
  for (let i = 1; i <= tries; i++) {
    await walkDoor(client);
    try {
      await client.page.waitForFunction(() => window.__lobby?.visible === true, undefined, { timeout: 22_000 });
      return { attempts: i, stalls };
    } catch {
      const seam = await client.page
        .evaluate(() => ({
          status: window.__onlineMenu?.status ?? null,
          error: window.__onlineMenu?.error ?? null,
          code: window.__onlineMenu?.resolvedCode ?? null,
        }))
        .catch(() => null);
      stalls.push({ attempt: i, ...seam });
      console.log(`  ${client.who}/${what} attempt ${i} stalled: ${JSON.stringify(seam)}`);
      await client.page.reload({ waitUntil: 'load', timeout: 60_000 });
      await client.page.waitForFunction(() => window.__mainMenu?.visible === true, undefined, { timeout: 60_000 });
    }
  }
  throw new Error(`${what} never reached the lobby in ${tries} tries (live machine-pin)`);
}

// ---------------------------------------------------------------------------
// Flying
// ---------------------------------------------------------------------------

const KEYS = { left: 'KeyA', right: 'KeyD', up: 'KeyW', down: 'KeyS' };

async function holdKey(client, key, ms) {
  await client.page.keyboard.down(key);
  await sleep(ms);
  await client.page.keyboard.up(key);
}

/** Shut whatever overlay is up, so a retry starts from the same place. */
async function client_escape(client) {
  await client.page.keyboard.press('Escape');
  await sleep(400);
}

async function releaseAll(client) {
  for (const k of Object.values(KEYS)) await client.page.keyboard.up(k).catch(() => {});
  await client.page.mouse.up().catch(() => {});
}

/**
 * The point the client draws the TURRET wedge's words at, in canvas space.
 * `WHEEL_ORDER[0]` is `turret` and segment 0 sits at twelve o'clock
 * (`src/ui/build-wheel.ts` `segmentAngle`); the wheel is centred on the viewport
 * (the camera holds the docked ship there) and the outer ring is
 * `clamp(min(w,h) * 0.36, 120, 230)` (`src/ui/hud-geometry.ts` `wheelRadius`),
 * with the words drawn at 0.6 r. CONFIRMED BY EYE at 1280×800 against the offline
 * dry run: r = 230, the point is (640, 262), and the frame
 * images/actions-offline-wheel-at-spawn.png shows it on the word TURRET.
 */
function turretWedgePoint(box) {
  const r = Math.max(120, Math.min(230, Math.min(box.width, box.height) * 0.36));
  return { x: box.width / 2, y: box.height / 2 - r * 0.6 };
}

// ---------------------------------------------------------------------------
// COPY LOG — the game's own export button
// ---------------------------------------------------------------------------

async function openPause(client) {
  await client.page.keyboard.press('Escape');
  await sleep(900);
}

async function copyLog(client, tag) {
  const { page } = client;
  const button = page.locator('#playtest-copy-log-button');
  await button.waitFor({ state: 'visible', timeout: 20_000 });
  const label = (await button.textContent())?.trim() ?? '';
  // What is actually on top of the button — the check that caught the connect-trace
  // panel painting over the lobby in `online-rush-swallowed`.
  const elementAtButton = await page.evaluate(() => {
    const b = document.querySelector('#playtest-copy-log-button');
    if (!b) return null;
    const r = b.getBoundingClientRect();
    const el = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return el ? (el.id ? `${el.tagName}#${el.id}` : el.tagName) : null;
  });
  const downloadPromise = page.waitForEvent('download', { timeout: 6_000 }).catch(() => null);
  await button.click();
  await sleep(1_200);
  const pressedLabel = (await button.textContent())?.trim() ?? '';
  await shot(client, tag, 'copylog');
  let text = '';
  try {
    text = await page.evaluate(() => navigator.clipboard.readText());
  } catch {
    text = '';
  }
  let via = 'clipboard';
  if (!text) {
    const dl = await downloadPromise;
    if (dl) {
      const path = join(OUT, `online-actions-${tag}-${client.who}-log.download.json`);
      await dl.saveAs(path);
      text = readFileSync(path, 'utf8');
      via = `download:${dl.suggestedFilename()}`;
    }
  }
  if (!text) throw new Error('COPY LOG produced neither a clipboard payload nor a download');
  return { text, label, pressedLabel, via, elementAtButton };
}

// ---------------------------------------------------------------------------
// The phases
// ---------------------------------------------------------------------------

/**
 * WHERE IS MY OWN STATION, IN SCREEN PIXELS? The camera holds the ship at screen
 * centre, so the station's offset from centre IS the direction home — and this
 * round has no `?debug=1` seam to ask (see the header). It is read off the frame
 * instead: a station wears a thick saturated ring in its owner's colour (azure or
 * cyan), which is the only large blue-dominant object in the play area. HUD bands
 * are excluded by rectangle — the wave clock and hull bar along the top, the
 * control legend along the bottom, the minimap and home bar down the right.
 *
 * Two passes: a centroid over every masked pixel, then a second over only those
 * within 220 px of the first. The second pass is what removes the ship's own trail
 * and a distant nameplate from the answer.
 *
 * VALIDATED against three frames whose station position I had already read by eye:
 *   online-actions-c1-host-spawn.png       true ~(736,400)  read (695,393)
 *   online-actions-d1-host-wheel-open.png  true ~(348,232)  read (380,254)  [pruned]
 *   online-actions-c1-host-wheel-open.png  true ~(1065,408) read (918,418)
 * Never exact, and it does not need to be: it is used as a BEARING, and the
 * arrival test is the wheel actually opening, which is not a guess at all.
 */
async function findStation(client) {
  const png = await client.page.screenshot();
  return client.page.evaluate(async (b64) => {
    const blob = await (await fetch(`data:image/png;base64,${b64}`)).blob();
    const bmp = await createImageBitmap(blob);
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    const g = c.getContext('2d');
    g.drawImage(bmp, 0, 0);
    const { data, width, height } = g.getImageData(0, 0, bmp.width, bmp.height);
    const hits = [];
    for (let y = 90; y < height - 70; y++) {
      for (let x = 0; x < width - 170; x++) {
        const i = (y * width + x) * 4;
        const R = data[i];
        const B = data[i + 2];
        if (B > 150 && R < 120 && B - R > 70) hits.push([x, y]);
      }
    }
    if (hits.length < 120) return { found: false, n: hits.length };
    const mean = (pts) => {
      let sx = 0;
      let sy = 0;
      for (const [x, y] of pts) {
        sx += x;
        sy += y;
      }
      return [sx / pts.length, sy / pts.length];
    };
    const [x0, y0] = mean(hits);
    const near = hits.filter(([x, y]) => Math.hypot(x - x0, y - y0) <= 220);
    const [x1, y1] = mean(near.length >= 120 ? near : hits);
    return { found: true, x: Math.round(x1), y: Math.round(y1), n: hits.length, kept: near.length };
  }, png.toString('base64'));
}

/** Thrust toward the station until it is close to screen centre, braking into the
 *  last stretch so the ship settles instead of sailing past. */
async function flyHome(client, budgetMs) {
  const cx = client.box.width / 2;
  const cy = client.box.height / 2;
  const end = now() + budgetMs;
  let last = null;
  while (now() < end) {
    const s = await findStation(client);
    last = s;
    if (!s.found) return { arrived: false, why: 'station not on screen', last: s };
    const dx = s.x - cx;
    const dy = s.y - cy;
    const d = Math.hypot(dx, dy);
    if (d <= 90) return { arrived: true, offset: Math.round(d), last: s };
    const long = d > 260;
    if (Math.abs(dx) > 40) await holdKey(client, dx > 0 ? KEYS.right : KEYS.left, long ? 300 : 140);
    if (Math.abs(dy) > 40) await holdKey(client, dy > 0 ? KEYS.down : KEYS.up, long ? 300 : 140);
    if (!long) {
      // Counter-burn: near the station, velocity is what overshoots.
      if (Math.abs(dx) > 40) await holdKey(client, dx > 0 ? KEYS.left : KEYS.right, 110);
      if (Math.abs(dy) > 40) await holdKey(client, dy > 0 ? KEYS.up : KEYS.down, 110);
    }
    await sleep(150);
  }
  return { arrived: false, why: 'budget', last };
}

/**
 * Mine, then come back. Neither half works alone and both were measured:
 *
 *   NO THRUST AT ALL, 120 s → still docked, and TOTAL still 3. Nothing drifts into
 *     range on its own (images/dock-mining-t120s.png). Mining requires motion.
 *   THRUST, ANY PATTERN → ore arrives, and the station does not come back. A box
 *     of equal legs returns the ship's VELOCITY to zero but not its POSITION, and
 *     `+t, −2t, +t` does not either once drag and rock collisions have eaten the
 *     symmetry it assumes. Three live rounds ended with the wheel refusing
 *     "get closer to your station" (b1 at 120 s, c1 at 69 s, d1 at 40 s).
 *
 * So the ship mines in short bursts and is STEERED back between them, by the only
 * bearing this round has: the station's own ring, found in the frame. The trigger
 * stays down throughout — AUTO-AIM takes whatever is in range on the way out and
 * on the way back.
 */
async function mineNearHome(client, tag, budgetMs) {
  const legs = [KEYS.left, KEYS.up, KEYS.right, KEYS.down];
  const t0 = now();
  await client.page.mouse.move(client.box.x + client.box.width * 0.5, client.box.y + client.box.height * 0.5);
  await client.page.mouse.down();
  const trips = [];
  let i = 0;
  while (now() - t0 < budgetMs) {
    // Out: one burst away from home, into the rock field, then coast through it
    // with the trigger down. Long enough to reach rocks — a 900 ms burst got the
    // ship back every time but never past its own empty apron (e1: two trips,
    // both home inside 80 px, and TOTAL still 3).
    await holdKey(client, legs[i % legs.length], Number(process.env.QA_OUT_MS ?? 1_700));
    await sleep(Number(process.env.QA_COAST_MS ?? 4_500));
    await shot(client, tag, `mining-trip${i}`);
    // Back: steered, not hoped for.
    const home = await flyHome(client, 22_000);
    trips.push({ trip: i, ...home });
    i++;
  }
  await client.page.mouse.up();
  await releaseAll(client);
  await sleep(1_200);
  // One last correction with the trigger cold, so the taps land on a settled ship.
  const settle = await flyHome(client, 20_000);
  await releaseAll(client);
  await sleep(1_500);
  await shot(client, tag, 'after-mining');
  return { trips, settle, ms: now() - t0 };
}

/**
 * IS THE WHEEL ACTUALLY OPEN? Mean luminance of the box the word TURRET is drawn
 * in. There is no seam to ask (see the header), and the alternative — clicking and
 * hoping — is exactly how two rounds produced a "build phase" that never happened
 * and a transcript that did not say so. Open, that box holds white text on the
 * wheel's lit face; closed, it is starfield. The screenshot is decoded in the page
 * itself, because Node has no image decoder here and the browser has three.
 */
async function wheelLuma(client) {
  const clip = {
    x: Math.round(client.box.x + client.box.width / 2 - 100),
    y: Math.round(client.box.y + client.box.height / 2 - 155),
    width: 200,
    height: 50,
  };
  const png = await client.page.screenshot({ clip });
  return client.page.evaluate(async (b64) => {
    const blob = await (await fetch(`data:image/png;base64,${b64}`)).blob();
    const bmp = await createImageBitmap(blob);
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    const g = c.getContext('2d');
    g.drawImage(bmp, 0, 0);
    const { data } = g.getImageData(0, 0, bmp.width, bmp.height);
    let sum = 0;
    for (let i = 0; i < data.length; i += 4) sum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    return sum / (data.length / 4);
  }, png.toString('base64'));
}

/**
 * IS THE WHEEL ACTUALLY OPEN? The BEFORE-AND-AFTER of pressing E, not an absolute
 * brightness. An absolute threshold was the first attempt and it was calibrated
 * honestly — five frames, two clean populations 14 apart (open 41.50 / 32.44,
 * closed 18.01 / 16.36 / 16.06) — and it still failed, because every one of those
 * frames was a SCARCE match. At ORE · RICH the same box reads 59.5 with the wheel
 * SHUT (images/online-actions-h1-host-wheel-open.png: the hint says "get closer to
 * your station" and the field behind it is full of lit ore), which the absolute
 * test called open. Scene brightness is not a constant, so the test cannot use it.
 *
 * The DIFFERENCE is scene-independent: opening the wheel paints a lit face and
 * white lettering over whatever was there, and shuts nothing else off. Measured on
 * the SCARCE frames, that step is about +25 (16 → 41.5). +10 is the floor here.
 */
async function wheelIsOpen(client) {
  const before = await wheelLuma(client);
  await client.page.keyboard.press('KeyE');
  await sleep(700);
  const after = await wheelLuma(client);
  return {
    before: Number(before.toFixed(2)),
    after: Number(after.toFixed(2)),
    delta: Number((after - before).toFixed(2)),
    open: after - before > 10,
  };
}

/**
 * Two real clicks on the drawn TURRET wedge, and the station photographed across
 * the whole construction. Nothing here is asserted from a seam — the wheel frame
 * shows whether E opened it and what the wedge said, the station frames show what
 * got built and when, and the log's `order`/`echo` lines say what the client asked
 * for and what authority answered.
 */
async function buildTwoTurrets(client, tag) {
  const out = { who: client.who, wedgePoint: turretWedgePoint(client.box) };
  // wheelIsOpen presses E itself, so it can measure the box either side of it.
  out.wheelCheck = await wheelIsOpen(client);
  await shot(client, tag, 'wheel-open');
  // Recorded, never swallowed. A closed wheel means the taps below hit empty space
  // and the phase proves nothing — which the transcript must say out loud.
  if (!out.wheelCheck.open) out.error = 'the Build wheel did not open — ship out of its own station range';

  const t0 = now();
  await client.press(out.wedgePoint);
  await sleep(1_500);
  await shot(client, tag, 'wheel-after-tap1');
  out.tapTwoAtMs = now() - t0;
  await client.press(out.wedgePoint);
  await sleep(700);
  await shot(client, tag, 'wheel-after-tap2');

  await client.page.keyboard.press('Escape');
  await sleep(300);
  out.stationShots = [];
  for (const at of [2, 6, 13, 20]) {
    while (now() - t0 < at * 1000) await sleep(150);
    await shot(client, tag, `station-t${at}s`);
    out.stationShots.push(at);
  }
  out.taps = 2;
  out.expectedOre = 2 * TURRET_COST;
  out.expectedBuildSeconds = TURRET_BUILD_S;
  return out;
}

/** One volley, photographed on both screens inside its ~0.5 s life. */
async function singleVolley(host, guest, tag, index) {
  const out = { index };
  for (const c of [host, guest]) await releaseAll(c);
  await sleep(1_500);
  const box = host.box;
  // Aim away from centre so a manual-fire shot still leaves the ship; under
  // AUTO-AIM the sim picks the target and this only sets the fallback heading.
  await host.page.mouse.move(box.x + box.width * 0.72, box.y + box.height * 0.5);
  const fired = now();
  await host.page.mouse.down();
  await sleep(90);
  await host.page.mouse.up();
  for (const wave of [1, 2]) {
    await Promise.all([shot(host, tag, `volley${index}-w${wave}`), shot(guest, tag, `volley${index}-w${wave}`)]);
    out[`wave${wave}MsAfterFire`] = now() - fired;
  }
  return out;
}

/**
 * The hull window. The camera holds the ship at screen centre and draws its bar
 * over it, so a tight clip there is the hull readout this build will give — the
 * numeric one (`__healthbarStage.hullReadout()`) is behind `?debug=1`, which would
 * have cost the online match. Frames are numbered so the sequence can be read in
 * order by eye: hull may fall, and may reset across a death, but between two
 * deaths it must never climb.
 */
async function hullBurst(client, tag, frames, everyMs) {
  const clip = {
    x: Math.round(client.box.x + client.box.width / 2 - 170),
    y: Math.round(client.box.y + client.box.height / 2 - 120),
    width: 340,
    height: 240,
  };
  const taken = [];
  for (let i = 0; i < frames; i++) {
    const at = now();
    await client.page
      .screenshot({ path: join(OUT, `online-actions-${tag}-${client.who}-hull-${String(i).padStart(2, '0')}.png`), clip })
      .catch(() => {});
    taken.push(now() - at);
    await sleep(everyMs);
  }
  return { frames, everyMs, clip };
}

// ---------------------------------------------------------------------------
// The walk
// ---------------------------------------------------------------------------

async function walk(browser, tag) {
  const host = await bootClient(browser, PC, 'host');
  const guest = await bootClient(browser, PC, 'guest');
  const run = { tag, base: BASE, capturedAt: new Date().toISOString(), phases: {} };
  try {
    for (const c of [host, guest]) {
      try {
        await setAutoAim(c, tag);
        run.phases[`autoAim-${c.who}`] = 'set through the SETTINGS screen';
      } catch (e) {
        run.phases[`autoAim-${c.who}`] = `FAILED: ${String(e).split('\n')[0]}`;
      }
    }

    run.hostDoor = await reachLobby(host, 'create', async (c) => {
      await pressPlay(c);
      await pressDoor(c, 'create');
    });
    const room = await host.page.evaluate(() => ({
      room: window.__lobby.room,
      online: window.__lobby.online,
      isHost: window.__lobby.isHost,
      humanCount: window.__lobby.humanCount,
    }));
    run.room = room;

    run.guestDoor = await reachLobby(guest, 'join', async (c) => {
      await pressPlay(c);
      await pressDoor(c, 'join');
      await c.page.waitForFunction(() => window.__onlineMenu?.screen === 'join', undefined, { timeout: 20_000 });
      await shot(c, tag, 'keypad-empty');
      for (const ch of room.room) await pressDoor(c, `key:${ch}`);
      await c.page.waitForFunction((want) => window.__onlineMenu?.code === want, room.room, { timeout: 20_000 });
      await shot(c, tag, 'keypad-typed');
      await pressDoor(c, 'submit');
    });
    await host.page.waitForFunction(() => window.__lobby?.humanCount === 2, undefined, { timeout: 30_000 });
    // ORE abundance, off the lobby's own chip. Declared plainly, because it is the
    // second thing this run changes about how the game plays: SCARCE is the shipped
    // default and its `totalOre` multiplier is 0.55 against RICH's 1.6
    // (src/sim/constants.ts ABUNDANCE), and at SCARCE four live rounds never mined
    // the 3 ore a SECOND turret costs before drifting out of the station's range.
    // It changes the ore in the ground, not what a build order is or how authority
    // answers one, which is what this gate is about.
    const oreClicks = Number(process.env.QA_ORE_CLICKS ?? 0);
    if (oreClicks > 0) {
      for (let i = 0; i < oreClicks; i++) {
        await host.press({ x: 608, y: 95 });
        await sleep(500);
      }
      run.abundance = await host.page.evaluate(() => window.__lobby?.abundance ?? null);
    }
    await shot(host, tag, 'roster');
    await shot(guest, tag, 'roster');

    // --- RUSH!, for real. -----------------------------------------------------
    const rush = await host.page.evaluate(() => window.__lobby.rushControl.physicalCenter);
    run.rushPoint = rush;
    run.rushElementAtPoint = await host.page.evaluate((pt) => {
      const el = document.elementFromPoint(pt.x, pt.y);
      return el ? (el.id ? `${el.tagName}#${el.id}` : el.tagName) : null;
    }, rush);
    await shot(host, tag, 'lobby-rush');
    await host.press({ x: rush.x, y: rush.y });
    let counting = false;
    for (let i = 0; i < 14 && !counting; i++) {
      await sleep(500);
      counting = await host.page.evaluate(
        () => window.__lobby?.counting === true || window.__mainMenu?.matchStarted === true,
      );
    }
    run.rushPressLanded = counting;
    run.rushViaSeam = false;
    if (!counting) {
      await shot(host, tag, 'rush-swallowed');
      await host.page.evaluate(() => window.__lobby.rush());
      run.rushViaSeam = true;
    }
    for (const c of [host, guest]) {
      await c.page.waitForFunction(() => window.__mainMenu?.matchStarted === true, undefined, { timeout: 60_000 });
    }
    run.matchStartedAt = new Date().toISOString();
    await sleep(3_000);
    await Promise.all([shot(host, tag, 'spawn'), shot(guest, tag, 'spawn')]);
    // The wire is checked at every phase boundary, and the record is kept whatever
    // it says. A phase measured after a silent drop is not evidence about the
    // network — it is evidence about a single-player game.
    run.wire = { atSpawn: { host: await wireState(host), guest: await wireState(guest) } };

    // --- BUILD #1, AT SPAWN. --------------------------------------------------
    // The ship is docked at its own station here and nowhere else is guaranteed,
    // so the first pair of taps is spent while that is certainly true. It carries
    // STARTING_ORE 3 and a turret costs 3, so the honest expectation is ONE turret
    // and one refusal — and a refusal is the more sensitive half of this gate:
    // "I built 2 but 3 got built" is a client inventing an order authority never
    // agreed to, which is exactly what a refused second tap would expose.
    run.buildAtSpawn = { host: await buildTwoTurrets(host, `${tag}-spawn`), guest: await buildTwoTurrets(guest, `${tag}-spawn`) };
    for (const c of [host, guest]) await client_escape(c);

    // --- MINE: pay for the second turret, and come back for it. --------------
    const mined = await Promise.all([mineNearHome(host, tag, MINE_MS), mineNearHome(guest, tag, MINE_MS)]);
    run.phases.mine = { host: mined[0], guest: mined[1] };
    run.wire.afterMine = { host: await wireState(host), guest: await wireState(guest) };

    // --- BUILD: two taps. -----------------------------------------------------
    // If the wheel is shut the ship is out of its own station's range, so steer
    // back and ask again rather than clicking into empty space and calling it a
    // build phase — which is what the previous three rounds did.
    const builds = [];
    for (const c of [host, guest]) {
      const tries = [];
      let attempt = null;
      for (let k = 0; k < 4; k++) {
        attempt = await buildTwoTurrets(c, tag);
        tries.push(attempt.wheelCheck);
        if (attempt.wheelCheck?.open) break;
        // Shut whatever is up, steer back, and ask again. Recorded either way.
        await client_escape(c);
        attempt.rehomed = await flyHome(c, 30_000);
      }
      builds.push({ ...attempt, wheelTries: tries });
    }
    run.build = { host: builds[0], guest: builds[1] };
    run.wire.afterBuild = { host: await wireState(host), guest: await wireState(guest) };

    // --- VOLLEY: fire once, photograph both screens. -------------------------
    try {
      run.volleys = [];
      for (const i of [1, 2]) {
        run.volleys.push(await singleVolley(host, guest, tag, i));
        await sleep(3_000);
      }
    } catch (e) {
      run.phases.volley = `FAILED: ${String(e).split('\n')[0]}`;
    }

    // --- FIGHT: the hull window. ---------------------------------------------
    try {
      for (const c of [host, guest]) {
        await c.page.mouse.move(c.box.x + c.box.width * 0.5, c.box.y + c.box.height * 0.5);
        await c.page.mouse.down();
      }
      const fightEnd = now() + FIGHT_MS;
      run.phases.hullBurst = (await Promise.all([hullBurst(host, tag, 60, 120), hullBurst(guest, tag, 60, 120)]))[0];
      while (now() < fightEnd) await sleep(500);
      for (const c of [host, guest]) await releaseAll(c);
      await Promise.all([shot(host, tag, 'fight'), shot(guest, tag, 'fight')]);
    } catch (e) {
      run.phases.fight = `FAILED: ${String(e).split('\n')[0]}`;
    }

    // --- CRUISE: straight-line flight, weapons cold, right up to the log. ----
    const cruiseStart = new Date().toISOString();
    const legs = [KEYS.right, KEYS.up, KEYS.left, KEYS.down];
    const legMs = Math.max(4_000, Math.floor(CRUISE_MS / legs.length));
    for (let i = 0; i < legs.length; i++) {
      await Promise.all([holdKey(host, legs[i], legMs), holdKey(guest, legs[(i + 2) % legs.length], legMs)]);
    }
    for (const c of [host, guest]) await releaseAll(c);
    run.phases.cruise = {
      startedAt: cruiseStart,
      endedAt: new Date().toISOString(),
      legs: legs.length,
      legMs,
      note: 'weapons cold; one direction change per leg',
    };
    await Promise.all([shot(host, tag, 'match'), shot(guest, tag, 'match')]);
    run.wire.atLog = { host: await wireState(host), guest: await wireState(guest) };

    // --- The instrument: pause, COPY LOG. ------------------------------------
    for (const c of [host, guest]) {
      await openPause(c);
      await shot(c, tag, 'pause');
      const got = await copyLog(c, tag);
      const log = JSON.parse(got.text);
      writeFileSync(join(OUT, `online-actions-${tag}-${c.who}-log.json`), JSON.stringify(log, null, 2));
      run[`log_${c.who}`] = {
        via: got.via,
        buttonLabel: got.label,
        buttonAfterPress: got.pressedLabel,
        elementAtButton: got.elementAtButton,
        summary: log.summary,
        env: log.env,
        durationMs: log.durationMs,
        dropped: log.dropped,
        pageErrors: c.errors,
      };
    }
    run.ok = true;
  } finally {
    await host.context.close().catch(() => {});
    await guest.context.close().catch(() => {});
  }
  return run;
}

const tag = process.argv[2] ?? 'r1';
const attempts = Number(process.argv[3] ?? 2);

const browser = await chromium.launch({
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});
let last = null;
for (let i = 1; i <= attempts; i++) {
  try {
    console.log(`--- ${tag} attempt ${i}/${attempts} ---`);
    last = await walk(browser, tag);
    console.log(`${tag}: OK room=${last.room?.room}`);
    break;
  } catch (e) {
    console.log(`${tag} attempt ${i} failed: ${String(e).split('\n').slice(0, 3).join(' | ')}`);
    last = { tag, attempt: i, error: String(e).split('\n').slice(0, 4).join(' | '), ok: false };
  }
}
await browser.close();
writeFileSync(join(OUT, `online-actions-${tag}-run.json`), JSON.stringify(last, null, 2));
console.log(
  JSON.stringify(
    {
      ok: last?.ok,
      room: last?.room?.room,
      rushPressLanded: last?.rushPressLanded,
      rushElementAtPoint: last?.rushElementAtPoint,
      host: last?.log_host?.summary,
      guest: last?.log_guest?.summary,
    },
    null,
    2,
  ),
);
