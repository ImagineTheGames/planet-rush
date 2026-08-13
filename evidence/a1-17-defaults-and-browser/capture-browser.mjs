/**
 * evidence/a1-17-defaults-and-browser/capture-browser.mjs — THE LOBBY BROWSER,
 * two real clients on the REAL fleet. OWNER: QA Manager (a1-17 §3; n10-01 / #400
 * + u17-01 / #401).
 *
 * The developer's ask has two halves and they are graded separately:
 *
 *   PUBLIC — host a room on one client, FIND IT IN THE LIST on another, press
 *   JOIN, and land in the lobby **without typing a code**. The "without typing"
 *   is the whole feature, so the guest's keypad is never touched: the only
 *   presses the guest makes are PLAY, JOIN, and the row's own JOIN button, each
 *   at the physical point the client itself reported drawing it at.
 *
 *   PRIVATE — a private room must NOT appear in the list, and must still join by
 *   code. This half is answered by looking for the control that makes a room
 *   private: every control the online lobby draws is enumerated from the lobby's
 *   own seam and photographed. A toggle that is not drawn is not a toggle.
 *
 * AND THE THIRD THING, which is a privacy claim in its own right: **no row may
 * ever print a code.** Checked twice — every string on every row is searched for
 * the host's actual code, AND the allocator's `/rooms` payload is searched for
 * it too, because a code the client is handed is a code one screenshot away from
 * being on screen.
 *
 * REAL FLEET, NOT A LOCAL ONE. `https://planet-rush-allocator.fly.dev` is up
 * with 3 machines; the served client has that allocator's URL baked in at build
 * time. A local fleet would be testing a bundle nobody is served.
 *
 *   node evidence/a1-17-defaults-and-browser/capture-browser.mjs
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const IMAGES = resolve(HERE, '..', 'images');
const BASE = process.env.A1_17_BASE_URL ?? 'https://imaginethegames.github.io/planet-rush/';
const ALLOCATOR = process.env.A1_17_ALLOCATOR ?? 'https://planet-rush-allocator.fly.dev';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync(IMAGES, { recursive: true });

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

const browser = await chromium.launch();
const out = {
  base: BASE,
  allocator: ALLOCATOR,
  capturedAt: new Date().toISOString(),
  allocatorHealthBefore: await (await fetch(`${ALLOCATOR}/health`)).json(),
};

async function boot(label) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await page.addInitScript(() => localStorage.clear());
  page.on('console', (m) => {
    if (m.type() === 'error') console.log(`[${label} console.error] ${m.text()}`);
  });
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForSelector('canvas', { state: 'attached', timeout: 60_000 });
  await page.waitForFunction(() => typeof window.__mainMenu?.screen === 'string', undefined, { timeout: 40_000 });
  return { ctx, page };
}

/** Press a control at the point the client says it drew it. Never a seam method:
 *  a seam that opens the thing under test cannot also witness that it opened. */
async function pressKind(page, which, kind) {
  const box = await page.locator('canvas').boundingBox();
  const at = await page.evaluate(
    ({ which, kind }) => {
      const list = which === 'menu' ? window.__mainMenu?.controls : window.__onlineMenu?.doorControls;
      const c = (list ?? []).find((x) => x.kind === kind);
      return c ? { x: c.physicalCenter.x, y: c.physicalCenter.y } : null;
    },
    { which, kind },
  );
  if (!at) throw new Error(`no ${which} control of kind ${kind}`);
  await page.mouse.click(box.x + at.x, box.y + at.y);
  return at;
}

// ---------------------------------------------------------------------------
// THE HOST — PLAY → CREATE ROOM, on the real allocator.
// ---------------------------------------------------------------------------
const host = await boot('host');
await pressKind(host.page, 'menu', 'play');
await host.page.waitForFunction(() => window.__onlineMenu?.visible === true, undefined, { timeout: 20_000 });
await sleep(1200);
out.regionLine = await host.page.evaluate(() => window.__onlineMenu.regionLine);
out.regions = await host.page.evaluate(() => window.__onlineMenu.regions.map((r) => ({ ...r })));
await pressKind(host.page, 'doors', 'create');

// Watch the title advance while the allocator works — the connect narration.
const titles = [];
for (let i = 0; i < 60; i += 1) {
  const t = await host.page.evaluate(() => window.__onlineMenu?.title ?? '');
  if (t && titles.at(-1) !== t) titles.push(t);
  const inLobby = await host.page.evaluate(() => window.__lobby?.visible === true);
  if (inLobby) break;
  await sleep(500);
}
out.hostConnectTitles = titles;
await host.page.waitForFunction(() => window.__lobby?.visible === true, undefined, { timeout: 60_000 });
await sleep(1500);

const hostLobby = await host.page.evaluate(() => ({
  room: window.__lobby.room,
  online: window.__lobby.online,
  you: window.__lobby.you,
  isHost: window.__lobby.isHost,
  humanCount: window.__lobby.humanCount,
  size: window.__lobby.size,
  seatStates: window.__lobby.seatStates.map((s) => ({ index: s.index, label: s.label, live: s.live })),
}));
out.host = hostLobby;
const CODE = hostLobby.room;
console.log(`host room = ${CODE}  online=${hostLobby.online}  humans=${hostLobby.humanCount}`);

await host.page.screenshot({ path: join(IMAGES, 'a1-17-browser-host-lobby.png') });

/** THE PRIVACY HALF. Every control the ONLINE lobby draws, enumerated from the
 *  lobby's own seam — the same report the mobile suite turns into screenshot
 *  regions. A PRIVATE toggle would have to be in here to be pressable. */
out.hostLobbyControlInventory = await host.page.evaluate(() => {
  const l = window.__lobby;
  const named = [];
  for (const [k, v] of Object.entries(l)) {
    if (v && typeof v === 'object' && 'physicalCenter' in v) named.push({ key: k, kind: 'single' });
    if (Array.isArray(v) && v.length && v[0] && typeof v[0] === 'object' && 'physicalCenter' in v[0]) {
      named.push({ key: k, kind: 'list', count: v.length });
    }
  }
  return {
    seamKeys: Object.keys(l).sort(),
    controlBearingKeys: named,
    screen: l.screen,
    hintTitle: l.hintTitle,
  };
});
console.log('lobby control-bearing seam keys:', out.hostLobbyControlInventory.controlBearingKeys.map((c) => c.key).join(', '));

// The allocator's own view of the world, and whether it hands out codes.
const roomsRaw = await (await fetch(`${ALLOCATOR}/rooms`)).text();
out.allocatorRooms = JSON.parse(roomsRaw);
out.allocatorRoomsRaw = roomsRaw;
out.allocatorPayloadContainsCode = roomsRaw.toUpperCase().includes(String(CODE).toUpperCase());
console.log(`allocator /rooms carries ${out.allocatorRooms.rooms.length} room(s); contains host code? ${out.allocatorPayloadContainsCode}`);

// ---------------------------------------------------------------------------
// THE GUEST — PLAY → JOIN → the list → the row's own JOIN button. No keypad.
// ---------------------------------------------------------------------------
const guest = await boot('guest');
await pressKind(guest.page, 'menu', 'play');
await guest.page.waitForFunction(() => window.__onlineMenu?.visible === true, undefined, { timeout: 20_000 });
await sleep(800);
await pressKind(guest.page, 'doors', 'join');
await guest.page.waitForFunction(() => window.__onlineMenu?.screen === 'join', undefined, { timeout: 20_000 });
out.guestJoinModeOnArrival = await guest.page.evaluate(() => window.__onlineMenu.joinMode);
console.log(`guest JOIN screen opens in mode: ${out.guestJoinModeOnArrival}`);

// Wait for the host's room to show up in the guest's list.
let rows = [];
const listWaitStarted = Date.now();
while (Date.now() - listWaitStarted < 90_000) {
  rows = await guest.page.evaluate(() =>
    window.__onlineMenu.browseRows.map((r) => ({
      owner: r.owner, meta: r.meta, where: r.where, action: r.action, state: r.state, enabled: r.enabled,
      physicalCenter: { ...r.physicalCenter },
      physicalBounds: { ...r.physicalBounds },
      joinBounds: { ...r.joinBounds },
    })),
  );
  if (rows.length > 0) break;
  await sleep(2000);
}
out.guestListWaitMs = Date.now() - listWaitStarted;
out.guestRows = rows;
out.guestBrowseStamp = await guest.page.evaluate(() => window.__onlineMenu.browseStamp);
out.guestBrowseStale = await guest.page.evaluate(() => window.__onlineMenu.browseStale);
out.guestBrowseEmpty = await guest.page.evaluate(() => [...window.__onlineMenu.browseEmpty]);
out.guestBrowseHidden = await guest.page.evaluate(() => window.__onlineMenu.browseHidden);
console.log(`guest sees ${rows.length} row(s) after ${(out.guestListWaitMs / 1000).toFixed(0)}s — stamp "${out.guestBrowseStamp}"`);
for (const r of rows) console.log(`   row: owner="${r.owner}" meta="${r.meta}" where="${r.where}" action="${r.action}" state=${r.state} enabled=${r.enabled}`);

const listShot = join(IMAGES, 'a1-17-browser-guest-list.png');
await guest.page.screenshot({ path: listShot });
if (rows.length) {
  const b = rows[0].physicalBounds;
  out.guestRowZoom = zoomCrop(listShot, { x: b.x - 8, y: b.y - 8, width: b.width + 16, height: b.height + 16 }, 3, join(IMAGES, 'a1-17-browser-guest-row.png'));
}

/** DOES ANY ROW PRINT THE CODE? Every string on every row, searched for it. */
const codeUpper = String(CODE).toUpperCase();
out.rowStringsContainingCode = rows.flatMap((r, i) =>
  ['owner', 'meta', 'where', 'action', 'state']
    .filter((k) => String(r[k] ?? '').toUpperCase().includes(codeUpper))
    .map((k) => ({ row: i, field: k, value: r[k] })),
);
console.log(`row strings containing the code: ${out.rowStringsContainingCode.length}`);

// PRESS THE ROW'S OWN JOIN BUTTON, at its drawn rect's centre. No code typed.
out.guestKeypadPressesMade = 0;
if (rows.length) {
  const jb = rows[0].joinBounds;
  const box = await guest.page.locator('canvas').boundingBox();
  const pt = { x: box.x + jb.x + jb.width / 2, y: box.y + jb.y + jb.height / 2 };
  out.guestJoinPressedAt = pt;
  out.guestCodeFieldBeforePress = await guest.page.evaluate(() => window.__onlineMenu.code);
  await guest.page.mouse.click(pt.x, pt.y);

  const gtitles = [];
  for (let i = 0; i < 80; i += 1) {
    const t = await guest.page.evaluate(() => window.__onlineMenu?.title ?? '');
    if (t && gtitles.at(-1) !== t) gtitles.push(t);
    if (await guest.page.evaluate(() => window.__lobby?.visible === true)) break;
    await sleep(500);
  }
  out.guestConnectTitles = gtitles;
  out.guestLandedInLobby = await guest.page.evaluate(() => window.__lobby?.visible === true);
  if (out.guestLandedInLobby) {
    await sleep(2500);
    out.guestLobby = await guest.page.evaluate(() => ({
      room: window.__lobby.room,
      online: window.__lobby.online,
      you: window.__lobby.you,
      isHost: window.__lobby.isHost,
      humanCount: window.__lobby.humanCount,
    }));
    out.guestCodeFieldAfterPress = await guest.page.evaluate(() => window.__onlineMenu?.code ?? null);
    console.log(`guest landed: room=${out.guestLobby.room} (host had ${CODE})  seat=${out.guestLobby.you}  humans=${out.guestLobby.humanCount}`);
  } else {
    console.log(`guest did NOT land in a lobby. titles: ${gtitles.join(' -> ')}`);
  }
  await guest.page.screenshot({ path: join(IMAGES, 'a1-17-browser-guest-lobby.png') });
}

// The host's own roster, after the guest walked in off the list.
await sleep(2000);
out.hostAfterJoin = await host.page.evaluate(() => ({
  humanCount: window.__lobby.humanCount,
  seatStates: window.__lobby.seatStates.map((s) => ({ index: s.index, label: s.label })),
}));
await host.page.screenshot({ path: join(IMAGES, 'a1-17-browser-host-lobby-after-join.png') });
console.log(`host roster after join: humans=${out.hostAfterJoin.humanCount}  seats=${out.hostAfterJoin.seatStates.map((s) => s.label).join('/')}`);

await guest.ctx.close();
await host.ctx.close();
await browser.close();
out.allocatorHealthAfter = await (await fetch(`${ALLOCATOR}/health`)).json();
writeFileSync(join(HERE, 'readback-browser.json'), JSON.stringify(out, null, 2));
console.log('wrote readback-browser.json');
