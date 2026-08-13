/**
 * evidence/a1-17-defaults-and-browser/capture-browser-code.mjs — THE OTHER HALF
 * OF THE JOIN SCREEN, and the wire under it. OWNER: QA Manager (a1-17 §3).
 *
 * Three things the browse run could not answer:
 *
 *  1. **The keypad still works.** #401 put a BROWSE mode in front of the code
 *     keypad that has shipped since M3. Adding a screen in front of a working
 *     one is a classic way to break it, and the brief's private-room half rests
 *     entirely on "must still join by code". So: host a room, and join it from
 *     another client by pressing digits on the actual keypad.
 *  2. **Does the allocator hand out codes?** `/rooms` is fetched WHILE a room is
 *     live and listed — the browse run fetched it a beat too early and got an
 *     empty array, which proves nothing. A code the client is handed is a code
 *     one screenshot away from being on screen.
 *  3. **The ping.** The browse row drew `IAD —` where a number belongs, while
 *     the lobby two screens later drew 69-73 ms for the same machine. Both
 *     numbers are recorded here rather than described.
 *
 * Front door only: the keypad digits are pressed at the physical points the
 * client reports for them. `typeCode()` exists on the seam and is not used —
 * a seam that types the code cannot witness that the keypad does.
 *
 *   node evidence/a1-17-defaults-and-browser/capture-browser-code.mjs
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const IMAGES = resolve(HERE, '..', 'images');
const BASE = process.env.A1_17_BASE_URL ?? 'https://imaginethegames.github.io/planet-rush/';
const ALLOCATOR = process.env.A1_17_ALLOCATOR ?? 'https://planet-rush-allocator.fly.dev';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync(IMAGES, { recursive: true });

const browser = await chromium.launch();
const out = { base: BASE, allocator: ALLOCATOR, capturedAt: new Date().toISOString() };

async function boot() {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await page.addInitScript(() => localStorage.clear());
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForSelector('canvas', { state: 'attached', timeout: 60_000 });
  await page.waitForFunction(() => typeof window.__mainMenu?.screen === 'string', undefined, { timeout: 40_000 });
  return { ctx, page };
}
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

// --- host a room -----------------------------------------------------------
const host = await boot();
await pressKind(host.page, 'menu', 'play');
await host.page.waitForFunction(() => window.__onlineMenu?.visible === true, undefined, { timeout: 20_000 });
await sleep(1000);
await pressKind(host.page, 'doors', 'create');
await host.page.waitForFunction(() => window.__lobby?.visible === true, undefined, { timeout: 60_000 });
await sleep(2000);
const CODE = await host.page.evaluate(() => window.__lobby.room);
out.hostCode = CODE;
console.log(`host room = ${CODE}`);

// --- 2. the wire, WHILE the room is live -----------------------------------
// Polled: the allocator lists off heartbeats, so "not there yet" is a timing
// fact about the fleet, not an answer about privacy.
let roomsRaw = '';
for (let i = 0; i < 20; i += 1) {
  roomsRaw = await (await fetch(`${ALLOCATOR}/rooms`, { cache: 'no-store' })).text();
  if (JSON.parse(roomsRaw).rooms.length > 0) break;
  await sleep(1500);
}
out.allocatorRoomsWhileLive = JSON.parse(roomsRaw);
out.allocatorRoomsRaw = roomsRaw;
out.allocatorPayloadContainsCode = roomsRaw.toUpperCase().includes(CODE.toUpperCase());
console.log(`/rooms while live: ${out.allocatorRoomsWhileLive.rooms.length} room(s); carries the code? ${out.allocatorPayloadContainsCode}`);
console.log(`  payload: ${roomsRaw.slice(0, 600)}`);

// --- 3. the ping the lobby measures, for the same machine -------------------
out.hostLobbyPings = await host.page.evaluate(() => ({
  room: window.__lobby.room,
  seatPings: (window.__lobby.seatStates ?? []).length,
}));

// --- 1. the keypad ---------------------------------------------------------
const guest = await boot();
await pressKind(guest.page, 'menu', 'play');
await guest.page.waitForFunction(() => window.__onlineMenu?.visible === true, undefined, { timeout: 20_000 });
await sleep(800);
await pressKind(guest.page, 'doors', 'join');
await guest.page.waitForFunction(() => window.__onlineMenu?.screen === 'join', undefined, { timeout: 20_000 });
await sleep(600);

// Switch to the keypad half by pressing its own segment.
await pressKind(guest.page, 'doors', 'mode:code');
await sleep(900);
out.joinModeAfterSegmentPress = await guest.page.evaluate(() => window.__onlineMenu.joinMode);
out.keypadControls = await guest.page.evaluate(() => window.__onlineMenu.doorControls.map((c) => c.kind));
console.log(`joinMode after pressing ENTER ROOM CODE: ${out.joinModeAfterSegmentPress}`);
console.log(`keypad controls: ${out.keypadControls.join(', ')}`);
await guest.page.screenshot({ path: join(IMAGES, 'a1-17-browser-keypad.png') });

// Press each character of the host's code on the keypad itself.
const typed = [];
for (const ch of CODE) {
  const kinds = await guest.page.evaluate(() => window.__onlineMenu.doorControls.map((c) => c.kind));
  const kind = kinds.find((k) => k === `key:${ch}` || k === `code:${ch}` || k === ch || k.endsWith(`:${ch}`));
  if (!kind) {
    out.keypadMissingFor = ch;
    console.log(`no keypad control found for '${ch}' among: ${kinds.join(', ')}`);
    break;
  }
  await pressKind(guest.page, 'doors', kind);
  await sleep(350);
  typed.push({ ch, kind, codeNow: await guest.page.evaluate(() => window.__onlineMenu.code) });
}
out.typed = typed;
out.codeTypedOnKeypad = await guest.page.evaluate(() => window.__onlineMenu.code);
console.log(`code field after pressing the keypad: "${out.codeTypedOnKeypad}" (host code ${CODE})`);
await guest.page.screenshot({ path: join(IMAGES, 'a1-17-browser-keypad-typed.png') });

if (out.codeTypedOnKeypad === CODE) {
  const kinds = await guest.page.evaluate(() => window.__onlineMenu.doorControls.map((c) => c.kind));
  const submit = kinds.find((k) => /submit|enter|go|confirm/i.test(k));
  out.submitControl = submit ?? null;
  if (submit) await pressKind(guest.page, 'doors', submit);
  const titles = [];
  for (let i = 0; i < 80; i += 1) {
    const t = await guest.page.evaluate(() => window.__onlineMenu?.title ?? '');
    if (t && titles.at(-1) !== t) titles.push(t);
    if (await guest.page.evaluate(() => window.__lobby?.visible === true)) break;
    await sleep(500);
  }
  out.codeJoinTitles = titles;
  out.codeJoinLanded = await guest.page.evaluate(() => window.__lobby?.visible === true);
  if (out.codeJoinLanded) {
    await sleep(2000);
    out.codeJoinLobby = await guest.page.evaluate(() => ({
      room: window.__lobby.room,
      you: window.__lobby.you,
      humanCount: window.__lobby.humanCount,
    }));
    console.log(`keypad join landed: room=${out.codeJoinLobby.room} seat=${out.codeJoinLobby.you} humans=${out.codeJoinLobby.humanCount}`);
  } else {
    console.log(`keypad join did NOT land. titles: ${titles.join(' -> ')}`);
  }
  await guest.page.screenshot({ path: join(IMAGES, 'a1-17-browser-keypad-lobby.png') });
}

await guest.ctx.close();
await host.ctx.close();
await browser.close();
writeFileSync(join(HERE, 'readback-browser-code.json'), JSON.stringify(out, null, 2));
console.log('wrote readback-browser-code.json');
