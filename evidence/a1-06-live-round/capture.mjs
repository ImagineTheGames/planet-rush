/**
 * evidence/a1-06-live-round/capture.mjs — the a1-06 re-verification camera.
 * OWNER: QA Manager.
 *
 * a1-05 found two real defects on the live build and filed four unresolved
 * verdicts. Both fixes are now merged (#362, #363). This round re-attests them
 * against the build a player actually loads — and measures the one risk the
 * wave-interval fix introduces (a SCARCE match is 20% slower between waves;
 * nobody has ever played one to its end).
 *
 *   BASE  https://imaginethegames.github.io/planet-rush/
 *
 * THE GATE. Before any shot is worth anything the served build must actually
 * carry the fixes. Do NOT gate on the bundle FILENAME: `vite.config.ts` injects
 * an ISO build TIME into `__BUILD_INFO__`, so the content hash moves on every
 * build even when the source is byte-identical. Gate on the served SOURCEMAP
 * instead (`build.sourcemap: true`), which ships full `sourcesContent` — see
 * `verify-served-source.mjs`, which diffs the served original source against
 * `git show <sha>:<path>`. That is the honest answer to "what code is on this
 * page", and it beats both the filename and the on-screen badge.
 *
 * It asserts nothing. Shots write PNGs into `evidence/images/` and a readback
 * blob into `readback.json`; the claims live in `evidence/manifest.json`,
 * written after LOOKING at the images.
 *
 *   node evidence/a1-06-live-round/capture.mjs [shot-id ...]     (no args = all)
 *
 * The wave interval has NO shipped seam — `waveIntervalOf(world)` feeds
 * `hudFrame.waveInterval` and stops there. So the clock on the GLASS is the
 * evidence, read off a 2x crop and checked by arithmetic: for wave 1 the HUD
 * computes `countdownToNext = waveTime(2, interval) - t = interval - elapsed`,
 * so MATCH + NEXT sums to the interval itself. 151 was the defect; 180 is the
 * ratified SCARCE value.
 */
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const IMAGES = resolve(HERE, '..', 'images');
// Overridable so a long shot (`match-length` runs for a quarter of an hour) can
// be driven in its own process without two writers clobbering one blob.
const READBACK = join(HERE, process.env.A1_06_READBACK ?? 'readback.json');
const BASE = process.env.A1_06_BASE_URL ?? 'https://imaginethegames.github.io/planet-rush/';

const DESKTOP = { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, isMobile: false, hasTouch: false };
const DESKTOP_2X = { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2, isMobile: false, hasTouch: false };
const PHONE_PORTRAIT = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true };

/** The top-center wave-clock strip, in CSS px. At 2x this lands 720x124. */
const CLOCK_CLIP = { x: 460, y: 8, width: 360, height: 62 };

function url(query = '') {
  return BASE + (query ? (query.startsWith('?') ? query : '?' + query) : '');
}

async function settle(page, { ms = 1500 } = {}) {
  await page.waitForSelector('canvas', { state: 'attached', timeout: 45_000 });
  await page.evaluate(() => document.fonts?.ready);
  await page.waitForTimeout(ms);
}

/** The sha the PAGE says it is — `version.json`, fetched relative to the page. */
async function servedSha(page) {
  return page.evaluate(async () => {
    const stamped = window.__planetRush?.build?.sha;
    if (stamped) return stamped;
    try {
      const res = await fetch('./version.json', { cache: 'no-store' });
      return res.ok ? (await res.json()).sha : null;
    } catch {
      return null;
    }
  });
}

async function shoot(page, id, clip) {
  mkdirSync(IMAGES, { recursive: true });
  const path = join(IMAGES, `a1-06-${id}.png`);
  await page.screenshot({ path, ...(clip ? { clip } : {}) });
  return `images/a1-06-${id}.png`;
}

/** A real click at a point the CLIENT said it drew a control at. */
async function press(page, p) {
  const box = await page.locator('canvas').boundingBox();
  if (!box) throw new Error('no canvas');
  await page.mouse.click(box.x + p.x, box.y + p.y);
}

async function tap(page, p) {
  const box = await page.locator('canvas').boundingBox();
  if (!box) throw new Error('no canvas');
  await page.touchscreen.tap(box.x + p.x, box.y + p.y);
}

async function controlPoint(page, seam, kind) {
  const point = await page.evaluate(
    ([which, k]) => {
      const list =
        which === 'menu' ? (window.__mainMenu?.controls ?? []) : (window.__onlineMenu?.doorControls ?? []);
      const c = list.find((x) => x.kind === k);
      return c ? { x: c.physicalCenter.x, y: c.physicalCenter.y } : null;
    },
    [seam, kind],
  );
  if (!point) throw new Error(`no '${kind}' control drawn on the ${seam} screen`);
  return point;
}

async function toDoors(page, { touch = false } = {}) {
  await page.waitForFunction(() => window.__mainMenu?.visible === true, undefined, { timeout: 45_000 });
  const p = await controlPoint(page, 'menu', 'play');
  await (touch ? tap(page, p) : press(page, p));
  await page.waitForFunction(() => window.__onlineMenu?.visible === true, undefined, { timeout: 45_000 });
}

async function toLobby(page, door, { touch = false } = {}) {
  await toDoors(page, { touch });
  const p = await controlPoint(page, 'door', door);
  await (touch ? tap(page, p) : press(page, p));
  await page.waitForFunction(() => window.__lobby?.visible === true, undefined, { timeout: 90_000 });
  await page.waitForTimeout(900);
}

function lobbyReadback() {
  const l = window.__lobby;
  if (!l) return null;
  return {
    visible: l.visible,
    online: l.online,
    room: l.room,
    you: l.you,
    isHost: l.isHost,
    humanCount: l.humanCount,
    slotCount: l.slotCount,
    mode: l.mode,
    abundance: l.abundance,
    screen: l.screen,
    selectedMapId: l.selectedMapId,
    seatLabels: l.seatStates.map((s) => s.label),
  };
}

async function rush(page) {
  const c = await page.evaluate(() => {
    const p = window.__lobby?.rushControl.physicalCenter;
    return p ? { x: p.x, y: p.y } : null;
  });
  if (!c) throw new Error('no RUSH control drawn');
  await press(page, c);
  await page.waitForFunction(() => window.__mainMenu?.matchStarted === true, undefined, { timeout: 90_000 });
  return Date.now();
}

/** Attach an honest console/pageerror recorder to a page. */
function watchErrors(page, who, sink) {
  page.on('pageerror', (e) =>
    sink.push({ who, kind: 'pageerror', message: e.message, stack: (e.stack ?? '').split('\n').slice(0, 8) }),
  );
  page.on('console', (m) => {
    if (m.type() === 'error') sink.push({ who, kind: 'console.error', message: m.text() });
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// The shots
// ---------------------------------------------------------------------------

const SHOTS = {
  // --- 1. OFFLINE: the real player path, PLAY -> PLAY SOLO under YIELD SCARCE
  'wave-clock-offline': {
    device: DESKTOP_2X,
    query: '',
    async run(page, out) {
      const errs = [];
      watchErrors(page, 'solo', errs);
      await toLobby(page, 'solo');
      out.lobby = await page.evaluate(lobbyReadback);
      out.imageLobby = await shoot(page, 'wave-clock-lobby');
      const t0 = await rush(page);

      // Three readings across the first wave, each stamped with the wall-clock
      // offset from RUSH so the crop's own MATCH figure can be checked against it.
      out.readings = [];
      for (const at of [4, 20, 45]) {
        const wait = t0 + at * 1000 - Date.now();
        if (wait > 0) await sleep(wait);
        const image = await shoot(page, `wave-clock-offline-${String(at).padStart(3, '0')}s`, CLOCK_CLIP);
        out.readings.push({ targetS: at, actualS: +((Date.now() - t0) / 1000).toFixed(2), image });
      }
      out.imageFull = await shoot(page, 'wave-clock-offline-full');
      out.servedSha = await servedSha(page);
      out.pageErrors = errs;
    },
  },

  // --- 1b. …and the wave actually ARRIVING offline, not merely counted to ----
  // The discriminating pair: a 150 s world is already on WAVE 2/5 by 2:35; a
  // 180 s world is still on WAVE 1/5 with ~25 s left, and flips at 3:00.
  'wave-arrival-offline': {
    device: DESKTOP_2X,
    query: '',
    async run(page, out) {
      const errs = [];
      watchErrors(page, 'solo', errs);
      await toLobby(page, 'solo');
      out.lobby = await page.evaluate(lobbyReadback);
      const t0 = await rush(page);
      out.readings = [];
      // 145 s: a 150 s world is seconds from wave 2. 155 s: it has already
      // flipped. 185 s: a 180 s world has just flipped. 200 s: settled.
      for (const at of [145, 155, 175, 185, 200]) {
        const wait = t0 + at * 1000 - Date.now();
        if (wait > 0) await sleep(wait);
        const image = await shoot(page, `wave-arrival-offline-${String(at).padStart(3, '0')}s`, CLOCK_CLIP);
        out.readings.push({ targetS: at, actualS: +((Date.now() - t0) / 1000).toFixed(2), image });
      }
      out.imageFull = await shoot(page, 'wave-arrival-offline-full');
      out.servedSha = await servedSha(page);
      out.pageErrors = errs;
    },
  },

  // --- 2. ONLINE: a real gameserver, two clients, host RUSHes ---------------
  'wave-clock-online': {
    multi: true,
    async run(browser, out) {
      const hostCtx = await browser.newContext(DESKTOP_2X);
      const guestCtx = await browser.newContext(DESKTOP_2X);
      const host = await hostCtx.newPage();
      const guest = await guestCtx.newPage();
      const errs = [];
      watchErrors(host, 'host', errs);
      watchErrors(guest, 'guest', errs);
      try {
        await host.goto(url(''), { waitUntil: 'load', timeout: 60_000 });
        await guest.goto(url(''), { waitUntil: 'load', timeout: 60_000 });

        await toLobby(host, 'create');
        out.hostLobby = await host.evaluate(lobbyReadback);
        const code = out.hostLobby.room;
        out.room = code;

        await toDoors(guest);
        await press(guest, await controlPoint(guest, 'door', 'join'));
        await guest.waitForFunction(() => window.__onlineMenu?.screen === 'join', undefined, { timeout: 30_000 });
        for (const ch of code.split('')) {
          await guest.evaluate((c) => window.__onlineMenu.typeCode(c), ch);
          await guest.waitForTimeout(120);
        }
        await guest.evaluate(() => window.__onlineMenu.submit());
        await guest.waitForFunction(() => window.__lobby?.visible === true, undefined, { timeout: 90_000 });
        await guest.waitForTimeout(1500);
        out.guestLobby = await guest.evaluate(lobbyReadback);
        out.hostLobbyWithGuest = await host.evaluate(lobbyReadback);
        out.imageHostLobby = await shoot(host, 'wave-clock-online-host-lobby');
        out.imageGuestLobby = await shoot(guest, 'wave-clock-online-guest-lobby');

        const t0 = await rush(host);
        await guest.waitForFunction(() => window.__mainMenu?.matchStarted === true, undefined, { timeout: 90_000 });

        out.readings = [];
        // Early reading (the a1-05 comparison point), then straight through the
        // first wave's arrival on BOTH clients — the half that needed a
        // protocol field is the half most likely to still be wrong.
        for (const at of [6, 30, 145, 155, 175, 185, 200]) {
          const wait = t0 + at * 1000 - Date.now();
          if (wait > 0) await sleep(wait);
          const g = await shoot(guest, `wave-clock-online-guest-${String(at).padStart(3, '0')}s`, CLOCK_CLIP);
          const h = await shoot(host, `wave-clock-online-host-${String(at).padStart(3, '0')}s`, CLOCK_CLIP);
          out.readings.push({
            targetS: at,
            actualS: +((Date.now() - t0) / 1000).toFixed(2),
            guestImage: g,
            hostImage: h,
          });
        }
        out.imageGuestFull = await shoot(guest, 'wave-clock-online-guest-full');
        out.imageHostFull = await shoot(host, 'wave-clock-online-host-full');
        out.servedShaHost = await servedSha(host);
        out.servedShaGuest = await servedSha(guest);
      } finally {
        out.pageErrors = errs;
        await hostCtx.close();
        await guestCtx.close();
      }
    },
  },

  // --- 2b. …and the FIELD across the wave-2 boundary, online ----------------
  // "A client predicting 180 against a server spawning at 150 would be worse
  // than the old honest 150." The wave counter alone cannot answer that: it is
  // `waveClockAt(t, interval)`, pure clock arithmetic on the client. Asteroids
  // are not — in an online match they are server-authoritative entities. So this
  // shoots FULL frames either side of the boundary and counts the rock pixels in
  // the play area, and the frames get looked at. Rocks appearing between 175 s
  // and 195 s (and NOT at 150 s) is the server agreeing with the clock.
  'wave-arrival-online-field': {
    multi: true,
    async run(browser, out) {
      const hostCtx = await browser.newContext(DESKTOP_2X);
      const guestCtx = await browser.newContext(DESKTOP_2X);
      const host = await hostCtx.newPage();
      const guest = await guestCtx.newPage();
      const errs = [];
      watchErrors(host, 'host', errs);
      watchErrors(guest, 'guest', errs);
      try {
        await host.goto(url(''), { waitUntil: 'load', timeout: 60_000 });
        await guest.goto(url(''), { waitUntil: 'load', timeout: 60_000 });
        await toLobby(host, 'create');
        const code = (await host.evaluate(lobbyReadback)).room;
        out.room = code;
        await toDoors(guest);
        await press(guest, await controlPoint(guest, 'door', 'join'));
        await guest.waitForFunction(() => window.__onlineMenu?.screen === 'join', undefined, { timeout: 30_000 });
        for (const ch of code.split('')) {
          await guest.evaluate((c) => window.__onlineMenu.typeCode(c), ch);
          await guest.waitForTimeout(120);
        }
        await guest.evaluate(() => window.__onlineMenu.submit());
        await guest.waitForFunction(() => window.__lobby?.visible === true, undefined, { timeout: 90_000 });
        await guest.waitForTimeout(1200);
        out.guestLobby = await guest.evaluate(lobbyReadback);
        const t0 = await rush(host);
        await guest.waitForFunction(() => window.__mainMenu?.matchStarted === true, undefined, { timeout: 90_000 });

        out.frames = [];
        for (const at of [140, 165, 178, 192, 205, 225]) {
          const wait = t0 + at * 1000 - Date.now();
          if (wait > 0) await sleep(wait);
          const clock = await shoot(guest, `wave-arrival-field-clock-${String(at).padStart(3, '0')}s`, CLOCK_CLIP);
          // ONE screenshot, saved AND measured. The first cut of this shot took a
          // second screenshot for the measurement, ~1 s after the one it saved —
          // and wave 2 landed in that gap, so the readback reported the step one
          // frame earlier than the saved image showed it. The frames were right
          // and the number beside them was not, which is the worst way round.
          // Measure exactly the bytes that get committed.
          const buf = await guest.screenshot();
          const full = `images/a1-06-wave-arrival-field-guest-${String(at).padStart(3, '0')}s.png`;
          writeFileSync(resolve(IMAGES, `a1-06-wave-arrival-field-guest-${String(at).padStart(3, '0')}s.png`), buf);
          // Rock ink: lit pixels in the play area, with the HUD bands (top strip,
          // bottom strip, bottom-right minimap) excluded so HUD text cannot be
          // mistaken for a rock.
          const ink = await guest.evaluate(async (b64) => {
            const img = new Image();
            img.src = 'data:image/png;base64,' + b64;
            await img.decode();
            const c = document.createElement('canvas');
            c.width = img.width;
            c.height = img.height;
            const g = c.getContext('2d');
            g.drawImage(img, 0, 0);
            const W = c.width;
            const H = c.height;
            const d = g.getImageData(0, 0, W, H).data;
            let lit = 0;
            let seen = 0;
            for (let y = Math.floor(H * 0.14); y < Math.floor(H * 0.86); y++) {
              for (let x = 0; x < W; x += 2) {
                if (x > W * 0.78 && y > H * 0.7) continue; // minimap corner
                const i = (W * y + x) << 2;
                seen++;
                if (d[i] > 40 && d[i + 1] > 40 && d[i + 2] > 40) lit++;
              }
            }
            return +((lit / seen) * 100).toFixed(4);
          }, buf.toString('base64'));
          out.frames.push({ targetS: at, actualS: +((Date.now() - t0) / 1000).toFixed(2), rockInkPct: ink, full, clock });
        }
        out.servedSha = await servedSha(guest);
      } finally {
        out.pageErrors = errs;
        await hostCtx.close();
        await guestCtx.close();
      }
    },
  },

  // --- 3. The clean-boot TypeError: zero is the pass ------------------------
  'clean-boot-errors': {
    multi: true,
    async run(browser, out) {
      out.sessions = [];
      // Six clean boots, matching a1-05's shape: desktop and 390 px, and the
      // walk that round actually took — doors, lobby, and into a match.
      const plan = [
        { id: 'desktop-doors', device: DESKTOP, depth: 'doors' },
        { id: 'desktop-lobby', device: DESKTOP, depth: 'lobby' },
        { id: 'desktop-match', device: DESKTOP, depth: 'match' },
        { id: 'phone-doors', device: PHONE_PORTRAIT, depth: 'doors', touch: true },
        { id: 'phone-lobby', device: PHONE_PORTRAIT, depth: 'lobby', touch: true },
        { id: 'phone-match', device: PHONE_PORTRAIT, depth: 'match', touch: true },
      ];
      for (const step of plan) {
        const ctx = await browser.newContext(step.device);
        const page = await ctx.newPage();
        const errs = [];
        watchErrors(page, step.id, errs);
        const rec = { id: step.id, depth: step.depth, errors: errs };
        try {
          await page.goto(url(''), { waitUntil: 'load', timeout: 60_000 });
          await page.waitForFunction(() => window.__mainMenu?.visible === true, undefined, { timeout: 45_000 });
          await page.waitForTimeout(6000);
          rec.afterMenu = errs.length;

          if (step.depth !== 'menu') {
            await toDoors(page, { touch: step.touch });
            await page.waitForTimeout(3000);
            rec.afterDoors = errs.length;
          }
          if (step.depth === 'lobby' || step.depth === 'match') {
            const p = await controlPoint(page, 'door', 'solo');
            await (step.touch ? tap(page, p) : press(page, p));
            await page.waitForFunction(() => window.__lobby?.visible === true, undefined, { timeout: 60_000 });
            await page.waitForTimeout(4000);
            rec.abundance = await page.evaluate(() => window.__lobby?.abundance ?? null);
            rec.afterLobby = errs.length;
          }
          if (step.depth === 'match') {
            await rush(page);
            await page.waitForTimeout(8000);
            rec.afterMatch = errs.length;
          }
          rec.image = await shoot(page, `clean-boot-${step.id}`);
          rec.servedSha = await servedSha(page);
        } catch (e) {
          rec.failure = String(e && e.message ? e.message : e);
        } finally {
          rec.total = errs.length;
          out.sessions.push(rec);
          await ctx.close();
        }
      }
      out.totalErrors = out.sessions.reduce((n, s) => n + (s.total ?? 0), 0);

      // THE CONTROL. "Zero uncaught errors" and "the recorder was never wired
      // up" produce identical output, so the recorder is made to catch one on
      // purpose. A clean boot, left to settle exactly like the six above, is
      // then given a genuine uncaught TypeError of the SAME SHAPE as the a1-05
      // defect — thrown from a `setTimeout` callback, i.e. off the boot stack,
      // which is where the original came from. If this does not land in the
      // sink, the six zeroes above mean nothing and must not be reported.
      const ctx = await browser.newContext(DESKTOP);
      const page = await ctx.newPage();
      const errs = [];
      watchErrors(page, 'control', errs);
      try {
        await page.goto(url(''), { waitUntil: 'load', timeout: 60_000 });
        await page.waitForFunction(() => window.__mainMenu?.visible === true, undefined, { timeout: 45_000 });
        await page.waitForTimeout(3000);
        const before = errs.length;
        await page.evaluate(() => {
          setTimeout(() => {
            const gone = null;
            gone.clear();
          }, 0);
        });
        await page.waitForTimeout(2500);
        out.control = {
          errorsBeforeInjection: before,
          errorsAfterInjection: errs.length,
          caught: errs.length > before,
          captured: errs.map((e) => e.message),
        };
      } finally {
        await ctx.close();
      }
    },
  },

  // --- 4. Match length: an actual SCARCE match, played to its end -----------
  // The risk this fix introduces. `collapseDeadline` re-anchors off the
  // per-world interval to hold the ratified 10-15 min rail (GDD §1); nobody has
  // played a 180 s SCARCE match to see whether it does. No seam reports the end
  // on a clean boot (the end-screen stage is `flags.debug` only), so this is
  // measured the honest way: poll the clock strip on the glass until the HUD
  // stops drawing a match clock, then LOOK at the frames either side.
  //
  // THE TRAP, hit on the first run: an unpiloted client is ELIMINATED long
  // before the match resolves — this one died 7th of 8 at 451 s with the
  // DEFEATED overlay replacing the HUD. Reporting 451 s as "match length" would
  // have been flatly wrong; it is how long an idle ship survives. So on
  // elimination the camera takes SPECTATE (GDD §2.7) and keeps watching the
  // live match to its actual end. SPECTATE has no clean-boot seam either
  // (`__endScreenStage.spectate` is debug-gated), so it is a real click at the
  // plate's measured centre — the LOWER of the two, deliberately: the upper one
  // is REMATCH and hitting it would silently restart the match and corrupt the
  // measurement. The click is verified, never assumed.
  'match-length': {
    device: DESKTOP_2X,
    query: '',
    timeoutMs: 30 * 60_000,
    async run(page, out) {
      const errs = [];
      watchErrors(page, 'match', errs);
      await toLobby(page, 'solo');
      out.lobby = await page.evaluate(lobbyReadback);
      const t0 = await rush(page);
      out.startedAt = new Date(t0).toISOString();

      // The HUD wave-clock strip is the witness that a match is still running:
      // `matchStarted` never goes false, and the strip goes dark the moment an
      // overlay replaces the HUD.
      const inkNow = async () => {
        const buf = await page.screenshot({ clip: CLOCK_CLIP });
        return page.evaluate(async (b64) => {
          const img = new Image();
          img.src = 'data:image/png;base64,' + b64;
          await img.decode();
          const c = document.createElement('canvas');
          c.width = img.width;
          c.height = img.height;
          const g = c.getContext('2d');
          g.drawImage(img, 0, 0);
          const d = g.getImageData(0, 0, c.width, c.height).data;
          let lit = 0;
          for (let i = 0; i < d.length; i += 4) if (d[i] > 90 || d[i + 1] > 90 || d[i + 2] > 90) lit++;
          return +((lit / (d.length / 4)) * 100).toFixed(3);
        }, buf.toString('base64'));
      };

      out.samples = [];
      const LIMIT_MS = 25 * 60_000;
      let spectating = false;
      let lastLive = 0;
      while (Date.now() - t0 < LIMIT_MS) {
        await sleep(15_000);
        const elapsed = +((Date.now() - t0) / 1000).toFixed(1);
        const ink = await inkNow();
        out.samples.push({ elapsed, inkPct: ink, phase: spectating ? 'spectating' : 'alive' });
        if (ink > 0.5) lastLive = elapsed;

        if (out.samples.length % 4 === 0) {
          await page.screenshot({
            path: join(IMAGES, `a1-06-match-length-${String(Math.round(elapsed)).padStart(4, '0')}s.png`),
            clip: CLOCK_CLIP,
          });
        }
        if (ink > 0.5 || elapsed <= 60) continue;

        // The HUD stopped. Either this client was eliminated, or the match is over.
        if (!spectating) {
          out.eliminatedAtS = elapsed;
          out.imageEliminated = await shoot(page, 'match-length-eliminated');
          // SPECTATE — the LOWER plate. Centre measured off the captured frame
          // (bands at CSS y 513-593 = REMATCH, y 608-680 = SPECTATE) rather than
          // guessed, and the outcome checked below.
          await press(page, { x: 638, y: 644 });
          await sleep(4000);
          const back = await inkNow();
          out.spectateClick = { at: elapsed, inkAfter: back, worked: back > 0.5 };
          if (back > 0.5) {
            spectating = true;
            out.imageSpectating = await shoot(page, 'match-length-spectating');
            continue;
          }
          // The click did not restore the HUD. Say so and stop rather than
          // reporting a number this camera cannot stand behind.
          out.spectateFailed = true;
          out.imageSpectateFailed = await shoot(page, 'match-length-spectate-failed');
          break;
        }

        // Spectating and the HUD went dark again: the match itself has resolved.
        out.endedAtS = elapsed;
        out.lastLiveClockS = lastLive;
        out.ended = true;
        break;
      }
      out.ended = out.ended === true;
      out.imageEnd = await shoot(page, 'match-length-end-screen');
      await sleep(5000);
      out.imageEndSettled = await shoot(page, 'match-length-end-settled');
      out.wallClockS = +((Date.now() - t0) / 1000).toFixed(1);
      out.servedSha = await servedSha(page);
      out.pageErrors = errs;
    },
  },
};

// ---------------------------------------------------------------------------

const requested = process.argv.slice(2);
const ids = requested.length ? requested : Object.keys(SHOTS);
const readback = existsSync(READBACK) ? JSON.parse(readFileSync(READBACK, 'utf8')) : {};

const browser = await chromium.launch();
for (const id of ids) {
  const shot = SHOTS[id];
  if (!shot) {
    console.error(`no such shot: ${id}`);
    continue;
  }
  const out = { id, base: BASE, capturedAt: new Date().toISOString() };
  const started = Date.now();
  try {
    if (shot.multi) {
      await shot.run(browser, out);
    } else {
      const ctx = await browser.newContext(shot.device);
      const page = await ctx.newPage();
      if (shot.timeoutMs) page.setDefaultTimeout(Math.min(shot.timeoutMs, 120_000));
      try {
        await page.goto(url(shot.query), { waitUntil: 'load', timeout: 60_000 });
        await settle(page, { ms: 800 });
        await shot.run(page, out);
      } finally {
        await ctx.close();
      }
    }
    out.ok = true;
  } catch (e) {
    out.ok = false;
    out.error = String(e && e.stack ? e.stack.split('\n').slice(0, 4).join(' | ') : e);
    console.error(`[${id}] FAILED: ${out.error}`);
  }
  out.tookS = +((Date.now() - started) / 1000).toFixed(1);
  readback[id] = out;
  writeFileSync(READBACK, JSON.stringify(readback, null, 2) + '\n');
  console.log(`[${id}] ${out.ok ? 'ok' : 'FAILED'} in ${out.tookS}s`);
}
await browser.close();
