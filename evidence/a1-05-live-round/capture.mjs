/**
 * evidence/a1-05-live-round/capture.mjs — the a1-05 evidence camera. OWNER: QA Manager.
 *
 * Unlike `evidence/capture.mjs`, which drives a locally-built `vite preview`, this
 * one points at the **LIVE GitHub Pages deployment** and nothing else. That is the
 * whole brief: twenty features merged with CI green and no attestation that any of
 * them reach the build a player actually loads. A lane checkout cannot answer that
 * question — only the served bundle can.
 *
 *   BASE  https://imaginethegames.github.io/planet-rush/
 *
 * Every shot re-reads `window.__planetRush.build.sha` (and `/version.json`) off the
 * page it just shot and records it beside the image, so an item in the manifest
 * names the build it was taken on rather than the build that happened to be main at
 * the time. main deploys roughly every half hour; the round records what it saw.
 *
 * It asserts nothing. Each shot writes PNGs into `evidence/images/` and a readback
 * blob into `readback.json`; the claims live in `evidence/manifest.json`, written
 * after LOOKING at the images.
 *
 *   node evidence/a1-05-live-round/capture.mjs [shot-id ...]     (no args = all)
 *
 * Two boots are reachable and they are not the same client:
 *   `?debug=1`  — skips the menu into an OFFLINE match, and installs the staging
 *                 seams (`__pressStage`, `__endScreenStage`, …). Everything about
 *                 the match is shot here.
 *   clean boot  — the main menu, THE DOORS, the lobby, the hangar. No staging
 *                 seams exist here at all, so these shots drive real presses on
 *                 the points the client itself reports having drawn.
 */
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const IMAGES = resolve(HERE, '..', 'images');
const READBACK = join(HERE, 'readback.json');
const BASE = process.env.A1_05_BASE_URL ?? 'https://imaginethegames.github.io/planet-rush/';
const ALLOCATOR = 'https://planet-rush-allocator.fly.dev';

const DESKTOP = { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, isMobile: false, hasTouch: false };
const DESKTOP_2X = { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2, isMobile: false, hasTouch: false };
const PHONE_PORTRAIT = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true };

function url(query = '') {
  return BASE + (query ? (query.startsWith('?') ? query : '?' + query) : '');
}

async function settle(page, { frozen = false, ms = 1500 } = {}) {
  await page.waitForSelector('canvas', { state: 'attached', timeout: 45_000 });
  if (frozen) {
    await page.waitForFunction(
      () => {
        const pr = window.__planetRush;
        const f = pr?.frozen;
        return typeof f === 'function' ? f() === true : f === true;
      },
      undefined,
      { timeout: 30_000 },
    );
  }
  await page.evaluate(() => document.fonts?.ready);
  await page.waitForTimeout(ms);
}

/**
 * The sha the PAGE says it is. `__planetRush.build` exists only under `?debug=1`,
 * so a clean boot falls back to the deployment's own `version.json` — fetched
 * relative to the page, which is what makes it right under the Pages subpath.
 */
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
  const path = join(IMAGES, `a1-05-${id}.png`);
  await page.screenshot({ path, ...(clip ? { clip } : {}) });
  return `images/a1-05-${id}.png`;
}

/** A real click at a point the CLIENT said it drew a control at. */
async function press(page, p) {
  const box = await page.locator('canvas').boundingBox();
  if (!box) throw new Error('no canvas');
  await page.mouse.click(box.x + p.x, box.y + p.y);
}

/** …and its thumb equivalent, for the phone shots. */
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

/** Walk a CLEAN boot as far as the doors: PLAY. */
async function toDoors(page) {
  await page.waitForFunction(() => window.__mainMenu?.visible === true, undefined, { timeout: 45_000 });
  await press(page, await controlPoint(page, 'menu', 'play'));
  await page.waitForFunction(() => window.__onlineMenu?.visible === true, undefined, { timeout: 45_000 });
}

async function toLobby(page, door) {
  await toDoors(page);
  await press(page, await controlPoint(page, 'door', door));
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
    size: l.size,
    mode: l.mode,
    abundance: l.abundance,
    screen: l.screen,
    selectedClass: l.selectedClass,
    selectedMapId: l.selectedMapId,
    seatLabels: l.seatStates.map((s) => s.label),
    seatCharacters: l.seatCharacters,
    levelBadges: l.levelBadges,
    hintTitle: l.hintTitle,
  };
}

/** Ask the ALLOCATOR whether a room is still held — the honest second witness. */
async function roomIsLive(code) {
  const res = await fetch(`${ALLOCATOR}/rooms/${code}/join`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  return res.ok;
}

// ---------------------------------------------------------------------------
// The shots
// ---------------------------------------------------------------------------

const SHOTS = {
  // --- 10a. The darker backdrop ---------------------------------------------
  'backdrop': {
    device: DESKTOP,
    query: 'debug=1&freeze=1',
    async run(page, out) {
      await settle(page, { frozen: true, ms: 1200 });
      out.image = await shoot(page, 'backdrop-frozen-desktop');
    },
  },

  // --- 10b. The sky moves with the far stars, not with the ship -------------
  'sky-parallax': {
    device: DESKTOP,
    query: 'debug=1&freeze=1',
    async run(page, out) {
      await settle(page, { frozen: true, ms: 1000 });
      out.frames = [];
      // Three camera stations along one straight flight, a screen-width apart.
      // `stage(coreFraction, distance)` is the only seam that moves the LOCAL ship
      // to a chosen place; the ring it also sets is irrelevant here and identical
      // in all three frames, so nothing but the camera changes between them.
      for (const [i, distance] of [200, 1044, 1888].entries()) {
        const staged = await page.evaluate((d) => window.__stationHealthStage.stage(1, d), distance);
        await page.waitForTimeout(900);
        const image = await shoot(page, `sky-flight-${i}`);
        const ship = await page.evaluate(() => window.__planetRush.shipWorld);
        out.frames.push({ i, distance, staged, ship, image });
      }
    },
  },

  // --- 9. The wave clock counts to the interval the match actually uses -----
  'wave-clock': {
    device: DESKTOP_2X,
    query: 'debug=1',
    async run(page, out) {
      await settle(page, { ms: 2500 });
      out.imageEarly = await shoot(page, 'wave-clock-early', { x: 460, y: 8, width: 360, height: 62 });
      await page.waitForTimeout(30_000);
      out.imageLater = await shoot(page, 'wave-clock-later', { x: 460, y: 8, width: 360, height: 62 });
      out.ticks = await page.evaluate(() => window.__planetRush?.ticks ?? null);
    },
  },

  // --- 9b. …and the same clock on the REAL player path (lobby → RUSH) -------
  'wave-clock-lobby': {
    device: DESKTOP_2X,
    query: '',
    async run(page, out) {
      await toLobby(page, 'solo');
      out.lobby = await page.evaluate(lobbyReadback);
      // Seat one bot so the match has an opponent, then RUSH.
      const seat1 = await page.evaluate(() => {
        const s = (window.__lobby?.seatStates ?? []).find((x) => x.index === 1);
        return s ? { x: s.physicalCenter.x, y: s.physicalCenter.y } : null;
      });
      if (seat1) await press(page, seat1);
      await page.waitForTimeout(400);
      const rush = await page.evaluate(() => {
        const c = window.__lobby?.rushControl.physicalCenter;
        return c ? { x: c.x, y: c.y } : null;
      });
      await press(page, rush);
      await page.waitForFunction(() => window.__mainMenu?.matchStarted === true, undefined, { timeout: 90_000 });
      await page.waitForTimeout(3000);
      out.imageEarly = await shoot(page, 'wave-clock-lobby-early', { x: 460, y: 8, width: 360, height: 62 });
      out.imageFull = await shoot(page, 'wave-clock-lobby-full');
    },
  },

  // --- 2. Station health reads true at any range ----------------------------
  'station-health': {
    device: DESKTOP,
    query: 'debug=1&freeze=1',
    async run(page, out) {
      await settle(page, { frozen: true, ms: 800 });
      out.frames = [];
      for (const [name, frac, dist] of [
        ['damaged-near', 0.35, 120],
        ['damaged-far', 0.35, 480],
        ['healthy-near', 1.0, 120],
        ['healthy-far', 1.0, 480],
      ]) {
        await page.evaluate(([f, d]) => window.__stationHealthStage.stage(f, d), [frac, dist]);
        await page.waitForTimeout(800);
        // Re-read the geometry AFTER the camera has caught up with the move.
        const geometry = await page.evaluate(([f, d]) => window.__stationHealthStage.stage(f, d), [frac, dist]);
        await page.waitForTimeout(300);
        const image = await shoot(page, `station-health-${name}`);
        const crop = await shoot(page, `station-health-${name}-crop`, {
          x: Math.max(0, Math.round(geometry.screen.x) - 130),
          y: Math.max(0, Math.round(geometry.screen.y) - 130),
          width: 260,
          height: 260,
        });
        out.frames.push({ name, geometry, image, crop });
      }
    },
  },

  // --- 8. Nameplates are always lit, including over a ship in combat --------
  'nameplates': {
    device: DESKTOP,
    query: 'debug=1&freeze=1',
    async run(page, out) {
      // FROZEN on purpose. On a live sim the staged bot has flown on by the time
      // the shutter opens, so the plate the seam reported and the plate in the
      // frame are different frames; frozen, the read and the picture agree.
      await settle(page, { frozen: true, ms: 1200 });
      // Out into open space first, so the staged bot lands on empty sky rather
      // than inside the home station's rings.
      await page.evaluate(() => window.__oreHudStage.mine(0));
      await page.waitForTimeout(900);
      out.staged = await page.evaluate(() => window.__nameplateStage.stageBot());
      await page.waitForTimeout(900);
      out.platesQuiet = await page.evaluate(() => window.__nameplateStage.plates());
      out.imageQuiet = await shoot(page, 'nameplates-quiet');
      // Now put that ship in a fight: beside us at 45% hull (so its bar draws)
      // with the sim's own firing flag set.
      out.combat = await page.evaluate(() => {
        const dmg = window.__healthbarStage.damageEnemy(0.45);
        const beams = window.__planetRush.stageCombat();
        return { dmg, beams };
      });
      await page.waitForTimeout(1200);
      out.platesCombat = await page.evaluate(() => window.__nameplateStage.plates());
      out.bars = await page.evaluate(() => window.__healthbarStage.bars());
      out.imageCombat = await shoot(page, 'nameplates-in-combat');
      const plate = (out.platesCombat ?? []).find((p) => p.kind === 'ship');
      out.cropCombat = await shoot(page, 'nameplates-in-combat-crop', {
        x: Math.max(0, Math.round((plate?.x ?? 760) - 190)),
        y: Math.max(0, Math.round((plate?.y ?? 400) - 90)),
        width: 380,
        height: 260,
      });
    },
  },

  // --- 6. Looted ore has a tell, and it clears when hold space frees --------
  'loot-tell': {
    device: DESKTOP,
    query: 'debug=1',
    async run(page, out) {
      await settle(page, { ms: 1500 });
      // A FULL hold, in open space: the state in which a kill's ore cannot be
      // picked up, which is the whole of the developer's report.
      out.full = await page.evaluate(() => {
        const s = window.__oreHudStage;
        const staged = s.mine(6);
        return { staged };
      });
      await page.waitForTimeout(1500);
      out.fullDrawn = await page.evaluate(() => ({
        hold: window.__oreHudStage.hold(),
        total: window.__oreHudStage.total(),
        readout: window.__oreHudStage.readout(),
        ship: window.__shipLoot ?? null,
      }));
      out.imageFull = await shoot(page, 'loot-hold-full');
      out.cropFull = await shoot(page, 'loot-hold-full-crop', { x: 480, y: 320, width: 320, height: 220 });
      // Free the hold at the station and watch the sim drain it into the bank.
      await page.evaluate(() => window.__oreHudStage.dock(6));
      await page.waitForTimeout(5000);
      out.freed = await page.evaluate(() => ({
        hold: window.__oreHudStage.hold(),
        total: window.__oreHudStage.total(),
        readout: window.__oreHudStage.readout(),
      }));
      out.imageFreed = await shoot(page, 'loot-hold-freed');
      // Half a hold: the pips must read 3 of 6 rather than full or hidden.
      await page.evaluate(() => window.__oreHudStage.mine(3));
      await page.waitForTimeout(1200);
      out.half = await page.evaluate(() => ({
        hold: window.__oreHudStage.hold(),
        total: window.__oreHudStage.total(),
        readout: window.__oreHudStage.readout(),
      }));
      out.imageHalf = await shoot(page, 'loot-hold-half');
      out.cropHalf = await shoot(page, 'loot-hold-half-crop', { x: 480, y: 320, width: 320, height: 220 });
    },
  },

  // --- 6b. …and the tell itself: a full hold FLASHES at ~2 Hz ---------------
  'hold-flash': {
    device: DESKTOP,
    query: 'debug=1',
    async run(page, out) {
      await settle(page, { ms: 1500 });
      // The under-ship hold row sits just below the centred ship, and the top-left
      // total sits at the origin. Shoot both in one narrow strip so a burst of
      // frames can be compared for the blink without the moving world in them.
      const CROP_HOLD = { x: 560, y: 405, width: 160, height: 36 };
      for (const [kind, ore] of [['full', 6], ['half', 3]]) {
        await page.evaluate((n) => window.__oreHudStage.mine(n), ore);
        await page.waitForTimeout(1200);
        out[kind] = await page.evaluate(() => ({
          hold: window.__oreHudStage.hold(),
          readout: window.__oreHudStage.readout(),
        }));
        for (let i = 0; i < 16; i++) {
          await shoot(page, `flash-${kind}-${i}`, CROP_HOLD);
          await page.waitForTimeout(90);
        }
      }
    },
  },

  // --- 5. The build wedge shows ONE cost number, and ORE is top-left --------
  'build-wheel': {
    device: DESKTOP,
    query: 'debug=1',
    async run(page, out) {
      await settle(page, { ms: 1500 });
      out.openedRich = await page.evaluate(() => window.__pressStage.openBuild(9));
      await page.waitForTimeout(900);
      out.wedgesRich = await page.evaluate(() => window.__pressStage.wedges());
      out.imageRich = await shoot(page, 'wheel-ore-9');
      out.setPoor = await page.evaluate(() => window.__pressStage.setOre(2));
      await page.waitForTimeout(900);
      out.wedgesPoor = await page.evaluate(() => window.__pressStage.wedges());
      out.imagePoor = await shoot(page, 'wheel-ore-2');
      out.imageOreLabel = await shoot(page, 'wheel-ore-label', { x: 0, y: 0, width: 220, height: 70 });
    },
  },

  // --- 3. The end screen calls an ally's win a VICTORY -----------------------
  'ally-victory': {
    device: DESKTOP,
    query: 'debug=1&sides=2',
    async run(page, out) {
      await settle(page, { ms: 2000 });
      out.side = await page.evaluate(() => window.__endScreenStage.side());
      out.staged = await page.evaluate(() => window.__endScreenStage.winAlly());
      await page.waitForFunction(() => window.__endScreenStage.screen() === 'result', undefined, { timeout: 30_000 });
      await page.waitForTimeout(500);
      out.result = await page.evaluate(() => window.__endScreenStage.result());
      out.buttons = await page.evaluate(() => window.__endScreenStage.buttons());
      out.image = await shoot(page, 'end-ally-victory');
    },
  },

  // --- 3b. …including the eliminated-then-ally-wins path --------------------
  'eliminated-then-ally-wins': {
    device: DESKTOP,
    query: 'debug=1&sides=2',
    async run(page, out) {
      await settle(page, { ms: 2000 });
      out.side = await page.evaluate(() => window.__endScreenStage.side());
      out.eliminated = await page.evaluate(() => window.__endScreenStage.eliminateLocal());
      await page.waitForFunction(() => window.__endScreenStage.screen() === 'defeated', undefined, { timeout: 30_000 });
      await page.waitForTimeout(600);
      out.defeatedResult = await page.evaluate(() => window.__endScreenStage.result());
      out.imageDefeated = await shoot(page, 'end-eliminated-defeated');
      await page.evaluate(() => window.__endScreenStage.spectate());
      await page.waitForTimeout(1200);
      out.stagedAllyWin = await page.evaluate(() => window.__endScreenStage.winAlly());
      await page.waitForFunction(() => window.__endScreenStage.screen() === 'result', undefined, { timeout: 30_000 });
      await page.waitForTimeout(500);
      out.result = await page.evaluate(() => window.__endScreenStage.result());
      out.image = await shoot(page, 'end-eliminated-then-ally-wins');
    },
  },

  // --- 11. The progression chain: summary, XP, a level ----------------------
  'summary-sequence': {
    device: DESKTOP,
    query: 'debug=1',
    async run(page, out) {
      await settle(page, { ms: 2500 });
      out.careerBefore = await page.evaluate(() => window.__endScreenStage.career());
      // Do some real work in the match first, so the summary has rows to count.
      await page.evaluate(() => window.__oreHudStage.dock(6));
      await page.waitForTimeout(4000);
      await page.evaluate(() => window.__pressStage.openBuild(20));
      await page.waitForTimeout(600);
      out.won = await page.evaluate(() => window.__endScreenStage.winLocal());
      await page.waitForFunction(() => window.__endScreenStage.screen() === 'result', undefined, { timeout: 30_000 });
      await page.waitForTimeout(400);
      out.beats = [];
      for (const [i, seconds] of [0, 1.2, 3.0, 6.0].entries()) {
        await page.evaluate((s) => window.__endScreenStage.summarySeek(s), seconds);
        await page.waitForTimeout(700);
        const frame = await page.evaluate(() => window.__endScreenStage.summary());
        const image = await shoot(page, `summary-beat-${i}`);
        out.beats.push({ i, seconds, frame, image });
      }
      await page.evaluate(() => window.__endScreenStage.summarySeek(null));
      await page.waitForTimeout(2500);
      out.careerAfter = await page.evaluate(() => window.__endScreenStage.career());
      out.finalFrame = await page.evaluate(() => window.__endScreenStage.summary());
      out.imageSettled = await shoot(page, 'summary-settled');
      out.storage = await page.evaluate(() => {
        const o = {};
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          o[k] = localStorage.getItem(k);
        }
        return o;
      });
    },
  },

  // --- 1b. The alarm rings once, and only for YOUR station (offline half) ---
  'alarm-own-station': {
    device: DESKTOP,
    query: 'debug=1',
    async run(page, out) {
      await settle(page, { ms: 2000 });
      out.atBoot = await page.evaluate(() => window.__alarmStage.read());
      out.audioAtBoot = await page.evaluate(() => window.__audioStage.read());
      // A RIVAL's home takes a beating first. Nothing of ours is being hit, so
      // neither the state machine nor the sting may move.
      out.rivalCoreBefore = await page.evaluate(() => window.__planetRush.coreHp(1));
      for (let i = 0; i < 12; i++) {
        await page.evaluate(() => window.__planetRush.damageCore(1, 40));
        await page.waitForTimeout(250);
      }
      out.afterRivalHit = await page.evaluate(() => window.__alarmStage.read());
      out.rivalCoreAfter = await page.evaluate(() => window.__planetRush.coreHp(1));
      out.imageRivalHit = await shoot(page, 'alarm-rival-station-hit');
      // Now OUR home, hit over and over: the state machine must go active and the
      // sting must sound exactly ONCE across a sustained siege.
      out.ownCoreBefore = await page.evaluate(() => window.__planetRush.coreHp(0));
      for (let i = 0; i < 16; i++) {
        await page.evaluate(() => window.__planetRush.damageCore(0, 25));
        await page.waitForTimeout(250);
      }
      out.afterOwnHit = await page.evaluate(() => window.__alarmStage.read());
      out.ownCoreAfter = await page.evaluate(() => window.__planetRush.coreHp(0));
      out.image = await shoot(page, 'alarm-own-station-hit');
      out.audioAfter = await page.evaluate(() => window.__audioStage.read());
    },
  },

  // --- 1c. …under a REAL siege, not a debug poke to the core ----------------
  'alarm-siege': {
    device: DESKTOP,
    query: 'debug=1',
    async run(page, out) {
      await settle(page, { ms: 2000 });
      out.atBoot = await page.evaluate(() => window.__alarmStage.read());
      // Abandon home: park the ship far out, leave the core undefended, and let a
      // real bot come for it. This is the only way to a genuine engagement — the
      // core-damage debug seam bypasses the state machine entirely (see the
      // `alarm-own-station` shot, which is why that one proves nothing).
      await page.evaluate(() => window.__oreHudStage.mine(0));
      out.samples = [];
      let activeAt = null;
      for (let i = 0; i < 100; i++) {
        await page.waitForTimeout(1500);
        const read = await page.evaluate(() => window.__alarmStage.read());
        const core = await page.evaluate(() => window.__planetRush.coreHp(0));
        out.samples.push({ t: (i + 1) * 1.5, read, core });
        if (read.active && activeAt === null) {
          activeAt = (i + 1) * 1.5;
          out.whenActive = read;
          out.image = await shoot(page, 'alarm-under-attack');
        }
        // Once it has been ringing a while, stop: the claim is that `sounds`
        // stays at one across a sustained siege.
        if (activeAt !== null && (i + 1) * 1.5 - activeAt > 22) break;
        if (core !== null && core <= 0) break;
      }
      out.activeAt = activeAt;
      out.final = await page.evaluate(() => window.__alarmStage.read());
      out.imageFinal = await shoot(page, 'alarm-siege-final');
    },
  },

  // --- 1. The alarm belongs to the seat the SERVER gave you (non-zero) ------
  'alarm-online-nonzero-slot': {
    multi: true,
    async run(browser, out) {
      const hostCtx = await browser.newContext(DESKTOP);
      const guestCtx = await browser.newContext(DESKTOP);
      const host = await hostCtx.newPage();
      const guest = await guestCtx.newPage();
      const errs = [];
      for (const [who, p] of [['host', host], ['guest', guest]]) {
        p.on('pageerror', (e) => errs.push(`${who} pageerror: ${e.message}`));
        p.on('console', (m) => {
          if (m.type() === 'error') errs.push(`${who} console: ${m.text()}`);
        });
      }
      try {
        await host.goto(url(''), { waitUntil: 'load', timeout: 60_000 });
        await guest.goto(url(''), { waitUntil: 'load', timeout: 60_000 });

        // HOST: PLAY → CREATE ROOM.
        await toLobby(host, 'create');
        out.hostLobby = await host.evaluate(lobbyReadback);
        const code = out.hostLobby.room;
        out.room = code;
        out.imageHostRoom = await shoot(host, 'alarm-online-host-room');

        // GUEST: PLAY → JOIN ROOM → the code, typed on the keypad.
        await toDoors(guest);
        await press(guest, await controlPoint(guest, 'door', 'join'));
        await guest.waitForFunction(() => window.__onlineMenu?.screen === 'join', undefined, { timeout: 30_000 });
        for (const ch of code.split('')) {
          await guest.evaluate((c) => window.__onlineMenu.typeCode(c), ch);
          await guest.waitForTimeout(120);
        }
        out.imageGuestKeypad = await shoot(guest, 'alarm-online-guest-keypad');
        await guest.evaluate(() => window.__onlineMenu.submit());
        await guest.waitForFunction(() => window.__lobby?.visible === true, undefined, { timeout: 90_000 });
        await guest.waitForTimeout(1500);
        out.guestLobby = await guest.evaluate(lobbyReadback);
        out.imageGuestRoom = await shoot(guest, 'alarm-online-guest-room');
        out.hostLobbyWithGuest = await host.evaluate(lobbyReadback);

        // `__alarmStage` is installed by `boot()`, so on a clean boot it does not
        // exist until the match is up — the seat the server gave this client is
        // therefore read HERE, off the lobby, and compared after RUSH.
        out.guestSeatFromServer = out.guestLobby?.you ?? null;
        out.hostSeatFromServer = out.hostLobby?.you ?? null;

        // HOST RUSHes; both land in the same online match.
        const rush = await host.evaluate(() => {
          const c = window.__lobby?.rushControl.physicalCenter;
          return c ? { x: c.x, y: c.y } : null;
        });
        await press(host, rush);
        await host.waitForFunction(() => window.__mainMenu?.matchStarted === true, undefined, { timeout: 90_000 });
        await guest.waitForFunction(() => window.__mainMenu?.matchStarted === true, undefined, { timeout: 90_000 });
        await guest.waitForTimeout(4000);

        out.guestAlarmInMatch = await guest.evaluate(() => window.__alarmStage.read());
        out.hostAlarmInMatch = await host.evaluate(() => window.__alarmStage.read());
        out.imageGuestMatch = await shoot(guest, 'alarm-online-guest-match');
        out.imageHostMatch = await shoot(host, 'alarm-online-host-match');
        out.servedShaHost = await servedSha(host);
        out.servedShaGuest = await servedSha(guest);
      } finally {
        out.pageErrors = errs;
        await hostCtx.close();
        await guestCtx.close();
      }
    },
  },

  // --- 4. The lobby picks the CHARACTER; the tier is shown, not chosen ------
  'lobby-character': {
    device: DESKTOP,
    query: '',
    async run(page, out) {
      await toLobby(page, 'solo');
      out.fresh = await page.evaluate(lobbyReadback);
      out.imageSeated = await shoot(page, 'lobby-roster-with-cast');
      // Click a bot row's BODY: that is the character cycle (a0-06). The solo
      // lobby already seats seven bots, so nothing needs to be opened first —
      // cycling a SEAT STATE here would only close the row.
      const before = await page.evaluate(() => window.__lobby.seatCharacters[1]);
      const body = await page.evaluate(() => {
        const c = (window.__lobby?.seatControls ?? []).find((x) => x.index === 1);
        return c ? { x: c.physicalCenter.x, y: c.physicalCenter.y } : null;
      });
      if (body) await press(page, body);
      await page.waitForTimeout(600);
      const after = await page.evaluate(() => window.__lobby.seatCharacters[1]);
      out.characterCycle = { before, after };
      out.afterCycle = await page.evaluate(lobbyReadback);
      out.imageCycled = await shoot(page, 'lobby-character-cycled');
      out.rosterCrop = await shoot(page, 'lobby-roster-crop', { x: 0, y: 120, width: 640, height: 400 });
      // RUSH, and read back the cast the SIM actually seated.
      const rush = await page.evaluate(() => {
        const c = window.__lobby?.rushControl.physicalCenter;
        return c ? { x: c.x, y: c.y } : null;
      });
      await press(page, rush);
      await page.waitForFunction(() => window.__mainMenu?.matchStarted === true, undefined, { timeout: 90_000 });
      await page.waitForTimeout(1500);
      out.worldCast = await page.evaluate(() => window.__lobby?.worldCast ?? null);
      out.imageMatch = await shoot(page, 'lobby-cast-in-match');
    },
  },

  // --- 4b. `?` opens the codex BY TAP, at 390 px ----------------------------
  'codex-by-tap-390': {
    device: PHONE_PORTRAIT,
    query: '',
    async run(page, out) {
      await page.waitForFunction(() => window.__mainMenu?.visible === true, undefined, { timeout: 45_000 });
      const play = await controlPoint(page, 'menu', 'play');
      await tap(page, play);
      await page.waitForFunction(() => window.__onlineMenu?.visible === true, undefined, { timeout: 45_000 });
      const solo = await controlPoint(page, 'door', 'solo');
      await tap(page, solo);
      await page.waitForFunction(() => window.__lobby?.visible === true, undefined, { timeout: 60_000 });
      await page.waitForTimeout(1000);
      out.viewport = await page.evaluate(() => ({
        inner: { w: window.innerWidth, h: window.innerHeight },
        logical: window.__lobby?.logicalViewport ?? null,
        isTouch: window.__lobby?.isTouch ?? null,
      }));
      // The solo lobby already seats seven bots, each with a `?`. Touch nothing
      // else: cycling a seat state would only CLOSE the row and leave its `?`
      // with no dossier to open.
      out.beforeTap = await page.evaluate(lobbyReadback);
      out.helpControls = await page.evaluate(() => window.__lobby?.seatHelpControls ?? []);
      out.imageBefore = await shoot(page, 'codex-390-lobby');
      const help = await page.evaluate(() => {
        const c = (window.__lobby?.seatHelpControls ?? []).find((x) => x.index === 1);
        return c ? { x: c.physicalCenter.x, y: c.physicalCenter.y } : null;
      });
      out.helpPoint = help;
      if (help) await tap(page, help);
      await page.waitForTimeout(1200);
      out.afterTap = await page.evaluate(lobbyReadback);
      out.image = await shoot(page, 'codex-390-after-tap');
      // If a plain tap did nothing, try the other input the hint is documented to
      // answer to — a long press — so the report can say which one works.
      if (!out.afterTap?.hintTitle && help) {
        const box = await page.locator('canvas').boundingBox();
        await page.touchscreen.tap(box.x + help.x, box.y + help.y);
        await page.waitForTimeout(200);
        await page.mouse.move(box.x + help.x, box.y + help.y);
        await page.mouse.down();
        await page.waitForTimeout(1400);
        out.afterLongPress = await page.evaluate(lobbyReadback);
        out.imageLongPress = await shoot(page, 'codex-390-after-long-press');
        await page.mouse.up();
      }
    },
  },

  // --- 7. A new room starts empty; an all-bot match plays offline -----------
  'room-starts-empty': {
    device: DESKTOP,
    query: '',
    async run(page, out) {
      await toLobby(page, 'create');
      out.fresh = await page.evaluate(lobbyReadback);
      out.image = await shoot(page, 'room-starts-empty');
      out.rosterCrop = await shoot(page, 'room-starts-empty-crop', { x: 0, y: 110, width: 660, height: 420 });
      const code = out.fresh?.room;
      out.roomLiveBeforeRush = code ? await roomIsLive(code) : null;
      // Seat two bots, RUSH, and ask the ALLOCATOR whether the room survived.
      for (const row of [1, 4]) {
        const p = await page.evaluate((i) => {
          const s = (window.__lobby?.seatStates ?? []).find((x) => x.index === i);
          return s ? { x: s.physicalCenter.x, y: s.physicalCenter.y } : null;
        }, row);
        if (p) await press(page, p);
        await page.waitForTimeout(500);
      }
      out.beforeRush = await page.evaluate(lobbyReadback);
      const rush = await page.evaluate(() => {
        const c = window.__lobby?.rushControl.physicalCenter;
        return c ? { x: c.x, y: c.y } : null;
      });
      await press(page, rush);
      await page.waitForFunction(() => window.__mainMenu?.matchStarted === true, undefined, { timeout: 90_000 });
      await page.waitForTimeout(2500);
      out.tell = await page.evaluate(() => {
        const el = document.getElementById('pr-local-revert');
        return el ? { text: el.textContent, buttons: el.querySelectorAll('button').length } : null;
      });
      out.imageRevert = await shoot(page, 'all-bot-match-offline');
      await new Promise((r) => setTimeout(r, 5000));
      out.roomLiveAfterRush = code ? await roomIsLive(code) : null;
      out.releasedRoom = code;
      // …and the match keeps running with nobody but bots in it.
      await page.waitForTimeout(6000);
      out.imageRunning = await shoot(page, 'all-bot-match-running');
    },
  },

  // --- 11b. The badge in the lobby, and the HANGAR --------------------------
  'lobby-badge-and-hangar': {
    device: DESKTOP,
    query: 'debug=1',
    async run(page, out) {
      // Same origin, same storage: win a match under ?debug=1, then reload CLEAN
      // and see whether the level the match paid shows on the lobby row and in
      // the hangar. That is the chain, end to end, in one browser context.
      await settle(page, { ms: 2500 });
      out.careerBefore = await page.evaluate(() => window.__endScreenStage.career());
      await page.evaluate(() => window.__endScreenStage.winLocal());
      await page.waitForFunction(() => window.__endScreenStage.screen() === 'result', undefined, { timeout: 30_000 });
      await page.evaluate(() => window.__endScreenStage.summarySkip());
      await page.waitForTimeout(3000);
      out.careerAfter = await page.evaluate(() => window.__endScreenStage.career());

      await page.goto(url(''), { waitUntil: 'load', timeout: 60_000 });
      await page.waitForFunction(() => window.__mainMenu?.visible === true, undefined, { timeout: 45_000 });
      await page.waitForTimeout(1200);
      out.imageMenu = await shoot(page, 'menu-after-a-win');
      // The HANGAR first — the fourth door.
      await page.evaluate(() => window.__mainMenu.hangar());
      await page.waitForTimeout(1500);
      out.hangar = await page.evaluate(() => ({
        screen: window.__mainMenu.screen,
        ship: window.__mainMenu.hangarShip,
        level: window.__mainMenu.hangarLevel,
        empty: window.__mainMenu.hangarEmpty,
        controls: window.__mainMenu.hangarControls.map((c) => c.kind),
      }));
      out.imageHangar = await shoot(page, 'hangar-empty-state');
      // …then the lobby, and the level badge on the roster.
      const back = await page.evaluate(() => {
        const c = window.__mainMenu.hangarControls.find((x) => x.kind === 'back');
        return c ? { x: c.physicalCenter.x, y: c.physicalCenter.y } : null;
      });
      if (back) await press(page, back);
      await page.waitForTimeout(1000);
      await toLobby(page, 'solo');
      out.lobby = await page.evaluate(lobbyReadback);
      out.badgeBounds = await page.evaluate(() => window.__lobby?.levelBadgeBounds ?? null);
      out.imageLobby = await shoot(page, 'lobby-level-badge');
      if (out.badgeBounds) {
        const b = out.badgeBounds;
        out.imageBadgeCrop = await shoot(page, 'lobby-level-badge-crop', {
          x: Math.max(0, b.x - 200),
          y: Math.max(0, b.y - 20),
          width: Math.min(600, b.width + 400),
          height: b.height + 40,
        });
      }
    },
  },
};

// ---------------------------------------------------------------------------

const want = process.argv.slice(2);
const ids = want.length ? want : Object.keys(SHOTS);
const store = existsSync(READBACK) ? JSON.parse(readFileSync(READBACK, 'utf8')) : {};

const browser = await chromium.launch();
for (const id of ids) {
  const shot = SHOTS[id];
  if (!shot) {
    console.error(`unknown shot: ${id}`);
    process.exitCode = 1;
    continue;
  }
  if (shot.multi) {
    const out = { id, base: BASE, capturedAt: new Date().toISOString() };
    try {
      await shot.run(browser, out);
    } catch (err) {
      out.error = String(err && err.message ? err.message : err);
    }
    out.servedSha = out.servedShaGuest ?? out.servedShaHost ?? null;
    store[id] = out;
    writeFileSync(READBACK, JSON.stringify(store, null, 2) + '\n');
    console.log(`[${id}] sha=${out.servedSha ?? '?'}${out.error ? ' ERROR: ' + out.error : ''}`);
    continue;
  }
  const ctx = await browser.newContext(shot.device);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`${e.message}\n${(e.stack ?? '').split('\n').slice(0, 6).join('\n')}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push('console: ' + m.text());
  });
  const out = { id, base: BASE, query: shot.query, capturedAt: new Date().toISOString() };
  try {
    await page.goto(url(shot.query), { waitUntil: 'load', timeout: 60_000 });
    await shot.run(page, out);
  } catch (err) {
    out.error = String(err && err.message ? err.message : err);
    try {
      out.errorImage = await shoot(page, `${id}-ERROR`);
    } catch {
      /* the page may be gone */
    }
  }
  try {
    out.servedSha = await servedSha(page);
  } catch {
    out.servedSha = null;
  }
  out.pageErrors = errors;
  store[id] = out;
  writeFileSync(READBACK, JSON.stringify(store, null, 2) + '\n');
  console.log(`[${id}] sha=${out.servedSha ?? '?'}${out.error ? ' ERROR: ' + out.error : ''}`);
  await ctx.close();
}
await browser.close();
