/**
 * evidence/capture-online-feel.mjs — GATE `online-feel`. OWNER: QA Manager.
 *
 * A NATURAL two-client live match, walked through the shipped front door with
 * real input on BOTH form factors, and measured with the game's OWN instrument:
 * the developer-facing COPY LOG button. No QA-private telemetry read, no debug
 * seam scraped for numbers — the button a player presses is pressed, and what it
 * puts on the clipboard is the evidence. Eating our own dog food is the point
 * (docs/netcode-audit.md §7, docs/playtest-log.md).
 *
 * THE WALK
 * ---------------------------------------------------------------------------
 *   PLAY → CREATE ROOM → the code → (second client) PLAY → JOIN ROOM → keypad →
 *   host RUSH! → both in one live match → fly for ~35 s → ESC/pause → COPY LOG.
 *
 * Every menu press is a real mouse click or a real touch tap on the physical point
 * the client itself reports drawing the control at (`__mainMenu`, `__onlineMenu`,
 * `__lobby` — read-only seams; they locate a control, they never actuate it). The
 * match itself is pointer/keyboard-driven, which the brief allows.
 *
 * WHAT IT SAVES, per run, into evidence/images/:
 *   online-feel-<tag>-<who>-log.json    the EXPORTED playtest log (clipboard)
 *   online-feel-<tag>-<who>-match.png   the arena the log was taken from
 *   online-feel-<tag>-<who>-copylog.png the COPY LOG button in its pressed state
 *   online-feel-<tag>-room.png          the host's lobby with the live room code
 *
 * Usage:
 *   node evidence/capture-online-feel.mjs [pc|phones] [attempts]
 *   EVIDENCE_BASE_URL=... to point at something other than the deployed client.
 */
import { chromium } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'images');
mkdirSync(OUT, { recursive: true });

/** The DEPLOYED client — the bundle a player loads, with the live allocator baked in. */
const BASE = process.env.EVIDENCE_BASE_URL ?? 'https://imaginethegames.github.io/planet-rush/';
/** How long the match runs before the log is taken. The instrument finalizes one
 *  telemetry sample per second, so this is also the sample count. */
const FLY_MS = Number(process.env.FEEL_FLY_MS ?? 38_000);

const PC = { name: 'pc', width: 1280, height: 800, dpr: 1, touch: false };
const IPHONE = { name: 'iphone', width: 390, height: 844, dpr: 3, touch: true };
const PIXEL = { name: 'pixel', width: 412, height: 915, dpr: 2.6, touch: true };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function bootClient(browser, profile) {
  const context = await browser.newContext({
    viewport: { width: profile.width, height: profile.height },
    deviceScaleFactor: profile.dpr,
    hasTouch: profile.touch,
    isMobile: profile.touch,
    // The COPY LOG button's first choice is the clipboard; grant it so the export
    // takes the path a real (permitted) browser takes, and can be read back.
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
    const x = box.x + p.x;
    const y = box.y + p.y;
    if (profile.touch) await page.touchscreen.tap(x, y);
    else await page.mouse.click(x, y);
  };
  return { profile, page, context, press, errors, box };
}

const menuPoint = (page, kind) =>
  page.evaluate((k) => {
    const c = (window.__mainMenu?.controls ?? []).find((x) => x.kind === k);
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

/** Fly for real, so the numbers describe a match somebody played. PC thrusts on
 *  WASD and fires with the mouse; a phone is tap-commanded around the arena
 *  (`tap-move`, the shipped touch scheme). */
async function fly(client, ms) {
  const { page, profile, box } = client;
  const end = Date.now() + ms;
  const keys = ['KeyW', 'KeyD', 'KeyS', 'KeyA'];
  let i = 0;
  while (Date.now() < end) {
    if (profile.touch) {
      // Tap a point away from the ship: the commander flies there. Walk a box so
      // the ship keeps moving (and keeps mispredicting) rather than parking.
      const pts = [
        { x: box.width * 0.3, y: box.height * 0.3 },
        { x: box.width * 0.7, y: box.height * 0.3 },
        { x: box.width * 0.7, y: box.height * 0.7 },
        { x: box.width * 0.3, y: box.height * 0.7 },
      ];
      const p = pts[i % pts.length];
      await page.touchscreen.tap(box.x + p.x, box.y + p.y);
    } else {
      const k = keys[i % keys.length];
      await page.keyboard.down(k);
      await sleep(700);
      await page.keyboard.up(k);
      // A shot in flight is one of the three things the audit says to watch.
      await page.mouse.move(box.x + box.width * (0.3 + 0.4 * ((i % 3) / 2)), box.y + box.height * 0.4);
      await page.mouse.down();
      await sleep(200);
      await page.mouse.up();
    }
    i++;
    await sleep(profile.touch ? 1_400 : 300);
  }
}

/** Open the pause menu — ESC on a desktop, the corner pause button on a phone —
 *  which is where the brief puts COPY LOG (docs/playtest-log.md §"two taps"). */
async function openPause(client) {
  if (!client.profile.touch) {
    await client.page.keyboard.press('Escape');
  } else {
    // The touch pause control is a 40-unit square at logical (72,16)
    // (`src/ui/pause-menu.ts` pauseButtonRect). A held-portrait phone runs under
    // the landscape lock's CSS rotation, so its physical point is
    // (physW − ly, lx) — `src/platform/orientation.ts` logicalToPhysical. The
    // DOM COPY LOG button appears the instant the overlay is up, so press and check.
    const b = client.box;
    const lx = 72 + 20;
    const ly = 16 + 20;
    for (const p of [
      { x: b.width - ly, y: lx }, // rotated (portrait held): the lock's remap
      { x: lx, y: ly }, // unrotated, in case the viewport came up landscape
      { x: b.width * 0.06, y: b.height * 0.05 },
    ]) {
      await client.page.touchscreen.tap(b.x + p.x, b.y + p.y);
      await sleep(700);
      if (await client.page.locator('#playtest-copy-log-button').isVisible().catch(() => false)) return;
    }
    // Last resort on a phone profile: the same ESC the desktop uses.
    await client.page.keyboard.press('Escape');
  }
  await sleep(700);
}

/** Press the real COPY LOG button and read back what it exported. Clipboard first
 *  (what the button prefers); the download fallback is caught too, because that is
 *  the path a phone that refuses the clipboard takes. */
async function copyLog(client, tag, who) {
  const { page } = client;
  const button = page.locator('#playtest-copy-log-button');
  await button.waitFor({ state: 'visible', timeout: 20_000 });
  const label = (await button.textContent())?.trim() ?? '';
  const hint = (await page.locator('#playtest-copy-log-hint').textContent().catch(() => ''))?.trim() ?? '';

  const downloadPromise = page.waitForEvent('download', { timeout: 6_000 }).catch(() => null);
  // A phone presses it with a finger. Playwright's `click()` drives the mouse,
  // which a touch-only context can leave waiting on actionability forever — so a
  // touch profile taps the button's own drawn rect, the way a thumb does.
  if (client.profile.touch) {
    const rect = await button.boundingBox();
    if (!rect) throw new Error('COPY LOG reported no box to tap');
    await page.touchscreen.tap(rect.x + rect.width / 2, rect.y + rect.height / 2);
  } else {
    await button.click();
  }
  await sleep(1_200);
  const pressedLabel = (await button.textContent())?.trim() ?? '';
  await page.screenshot({ path: join(OUT, `online-feel-${tag}-${who}-copylog.png`) });

  let text = '';
  try {
    text = await page.evaluate(() => navigator.clipboard.readText());
  } catch (e) {
    text = '';
  }
  let via = 'clipboard';
  if (!text) {
    const dl = await downloadPromise;
    if (dl) {
      const path = join(OUT, `online-feel-${tag}-${who}-log.download.json`);
      await dl.saveAs(path);
      text = readFileSync(path, 'utf8');
      via = `download:${dl.suggestedFilename()}`;
    }
  }
  if (!text) throw new Error('COPY LOG produced neither a clipboard payload nor a download');
  return { text, label, pressedLabel, hint, via };
}

/** The three numbers the audit's §5 gate is about, plus the wire they were taken
 *  on. Computed from the log's own `net` entries — the same rows a human reads. */
function summarize(log, onlyInMatch = false) {
  let net = log.events.filter((e) => e.kind === 'net').map((e) => e.data);
  // The session's socket is live from the LOBBY on, and a lobby second reconciles
  // nothing — so its corr/mispred are a structural zero that would flatter the
  // mean. `onlyInMatch` keeps the seconds that actually predicted a world.
  if (onlyInMatch) net = net.filter((s) => typeof s.recon === 'number' && s.recon > 0);
  const nums = (k) => net.map((s) => s[k]).filter((v) => typeof v === 'number');
  const max = (a) => (a.length ? Math.max(...a) : null);
  const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
  const sum = (a) => a.reduce((x, y) => x + y, 0);
  return {
    samples: net.length,
    rttMeanMs: mean(nums('rtt')),
    rttMaxMs: max(nums('rttMax')),
    jitterMeanMs: mean(nums('jitter')),
    jitterMaxMs: max(nums('jitter')),
    corrMeanUnits: mean(nums('corr')),
    corrMaxUnits: max(nums('corrMax')),
    mispredMean: mean(nums('mispred')),
    mispredMax: max(nums('mispred')),
    leadMeanTicks: mean(nums('lead')),
    leadMaxTicks: max(nums('lead')),
    snaps: sum(nums('snap')),
    resyncs: sum(nums('resync')),
    reconciles: sum(nums('recon')),
    rows: net,
  };
}

/**
 * Reload and re-walk a door until it reaches the lobby.
 *
 * WHY THIS LOOP EXISTS, said plainly: the LIVE fleet's socket-hop machine-pin is
 * un-armed at the time of capture (`fly.gameserver.toml` sets MATCH_ROUTER="fly"
 * in the merged code, but the running Machines predate that deploy), so Fly's edge
 * lands a ticketed upgrade on the room's own Machine only about half the time and
 * the other half is refused `joinError: bad-ticket`. The shipped client treats a
 * refused join as TERMINAL and offers no RETRY, so it simply sits on CONNECTING —
 * measured in evidence/images/online-final-wire-pin.txt. A reload is the only
 * retry a player has, and it is the only retry taken here. Nothing about the match
 * being measured is affected: once a socket is welcomed, it is an ordinary one.
 */
async function reachLobby(client, tag, what, walkDoor, tries = 8) {
  const stalls = [];
  for (let i = 1; i <= tries; i++) {
    await walkDoor(client);
    try {
      await client.page.waitForFunction(() => window.__lobby?.visible === true, undefined, { timeout: 22_000 });
      return { attempts: i, stalls };
    } catch {
      const seam = await client.page
        .evaluate(() => ({ status: window.__onlineMenu?.status ?? null, error: window.__onlineMenu?.error ?? null, code: window.__onlineMenu?.resolvedCode ?? null }))
        .catch(() => null);
      stalls.push({ attempt: i, ...seam });
      console.log(`  ${tag}/${what} attempt ${i} stalled: ${JSON.stringify(seam)}`);
      await client.page.reload({ waitUntil: 'load', timeout: 60_000 });
      await client.page.waitForFunction(() => window.__mainMenu?.visible === true, undefined, { timeout: 60_000 });
    }
  }
  throw new Error(`${what} never reached the lobby in ${tries} tries (live machine-pin)`);
}

async function walk(browser, hostProfile, guestProfile, tag) {
  const host = await bootClient(browser, hostProfile);
  const guest = await bootClient(browser, guestProfile);
  const run = { tag, base: BASE, capturedAt: new Date().toISOString(), host: hostProfile.name, guest: guestProfile.name };
  try {
    // --- The host opens a room through the front door. ----------------------
    run.hostDoor = await reachLobby(host, tag, 'create', async (c) => {
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
    await host.page.screenshot({ path: join(OUT, `online-feel-${tag}-room.png`) });

    // --- The guest types the code on the real keypad. -----------------------
    run.guestDoor = await reachLobby(guest, tag, 'join', async (c) => {
      await pressPlay(c);
      await pressDoor(c, 'join');
      await c.page.waitForFunction(() => window.__onlineMenu?.screen === 'join', undefined, { timeout: 20_000 });
      for (const ch of room.room) await pressDoor(c, `key:${ch}`);
      await c.page.waitForFunction((want) => window.__onlineMenu?.code === want, room.room, { timeout: 20_000 });
      await c.page.screenshot({ path: join(OUT, `online-feel-${tag}-guest-keypad.png`) });
      await pressDoor(c, 'submit');
    });
    await host.page.waitForFunction(() => window.__lobby?.humanCount === 2, undefined, { timeout: 30_000 });
    run.bothInRoom = true;
    await host.page.screenshot({ path: join(OUT, `online-feel-${tag}-roster.png`) });

    // --- RUSH! — authority starts the match on both clients. ----------------
    const rush = await host.page.evaluate(() => window.__lobby.rushControl.physicalCenter);
    await host.press({ x: rush.x, y: rush.y });
    for (const c of [host, guest]) {
      await c.page.waitForFunction(() => window.__mainMenu?.matchStarted === true, undefined, { timeout: 60_000 });
    }
    run.matchStarted = true;

    // --- A natural match: both fly, for real, for FLY_MS. -------------------
    await Promise.all([fly(host, FLY_MS), fly(guest, FLY_MS)]);
    for (const [who, c] of [['host', host], ['guest', guest]]) {
      await c.page.screenshot({ path: join(OUT, `online-feel-${tag}-${who}-match.png`) });
    }

    // --- The instrument: pause, press COPY LOG, keep what it exported. ------
    for (const [who, c] of [['host', host], ['guest', guest]]) {
      await openPause(c);
      const got = await copyLog(c, tag, who);
      const log = JSON.parse(got.text);
      writeFileSync(join(OUT, `online-feel-${tag}-${who}-log.json`), JSON.stringify(log, null, 2));
      run[who] = {
        via: got.via,
        buttonLabel: got.label,
        buttonAfterPress: got.pressedLabel,
        hint: got.hint,
        summary: log.summary,
        env: log.env,
        durationMs: log.durationMs,
        dropped: log.dropped,
        telemetry: summarize(log),
        telemetryInMatch: summarize(log, true),
        pageErrors: c.errors,
      };
    }
    run.ok = true;
  } finally {
    await host.context.close();
    await guest.context.close();
  }
  return run;
}

const which = process.argv[2] ?? 'both';
const attempts = Number(process.argv[3] ?? 4);

const browser = await chromium.launch({
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});
const plans = [];
if (which === 'pc' || which === 'both') plans.push([PC, PC, 'pc']);
if (which === 'phones' || which === 'both') plans.push([IPHONE, PIXEL, 'phones']);

const results = [];
for (const [h, g, tag] of plans) {
  let last = null;
  for (let i = 1; i <= attempts; i++) {
    try {
      console.log(`--- ${tag} attempt ${i}/${attempts} ---`);
      last = await walk(browser, h, g, tag);
      console.log(`${tag}: OK room=${last.room?.room} samples=${last.host?.telemetry?.samples}/${last.guest?.telemetry?.samples}`);
      break;
    } catch (e) {
      console.log(`${tag} attempt ${i} failed: ${String(e).split('\n')[0]}`);
      last = { tag, attempt: i, error: String(e).split('\n')[0], ok: false };
    }
  }
  results.push(last);
}
await browser.close();
writeFileSync(join(OUT, 'online-feel-readback.json'), JSON.stringify({ base: BASE, capturedAt: new Date().toISOString(), results }, null, 2));
console.log(JSON.stringify(results.map((r) => ({ tag: r.tag, ok: r.ok, room: r.room?.room, host: r.host?.telemetry, guest: r.guest?.telemetry })), null, 2).slice(0, 4000));
