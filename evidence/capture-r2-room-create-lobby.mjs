/**
 * evidence/capture-r2-room-create-lobby.mjs — GATE online-room-create, round 2.
 * OWNER: QA Manager.
 *
 * Drives the SHIPPED production bundle (live allocator baked in) through a REAL
 * pointer/touch press on the CREATE ROOM button and shoots the LOBBY the live
 * control plane's minted code opens onto — the screen a host reads the code off.
 *
 * The shipped websocket transport treats a socket that OPENS as joined, but on
 * Fly a ticketed upgrade can open and then be refused (`joinError:bad-ticket`)
 * when the edge replays it to the wrong machine — leaving the client stuck on
 * "CONNECTING…". A real host just taps CREATE again; so does this capture,
 * reloading and re-pressing until one attempt's socket lands on the room's
 * machine and the lobby paints. It records how many attempts that took, so the
 * flakiness is on the record rather than hidden.
 *
 * Usage: EVIDENCE_BASE_URL=http://localhost:4191 node evidence/capture-r2-room-create-lobby.mjs
 */
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'images');
const BASE = process.env.EVIDENCE_BASE_URL ?? 'http://localhost:4191';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function createDoorCenterLogical(viewW, viewH, isTouch) {
  const PAD = 16, GAP = 12, TITLE = 52, HINT = 18;
  const cw = Math.max(0, viewW - 2 * PAD), ch = Math.max(0, viewH - 2 * PAD);
  const titleH = Math.min(TITLE, ch);
  const msgH = Math.min(HINT, Math.max(0, ch - titleH));
  const actionH = Math.min(isTouch ? 56 : 48, Math.max(0, ch - titleH - msgH));
  const actionsY = PAD + ch - actionH;
  const midY = PAD + titleH + msgH + GAP;
  const midH = Math.max(0, actionsY - GAP - midY);
  const wanted = isTouch ? 64 : 56;
  const height = Math.max(0, Math.min(wanted, (midH - 2 * GAP) / 3 - HINT));
  const width = Math.min(420, cw);
  const block = height + HINT;
  const total = 3 * block + 2 * GAP;
  const top = midY + Math.max(0, (midH - total) / 2);
  const x = PAD + (cw - width) / 2;
  const createY = top + 1 * (block + GAP);
  return { x: x + width / 2, y: createY + height / 2 };
}
const toPhysical = (lx, ly, rotated, physW) => (rotated ? { x: physW - ly, y: lx } : { x: lx, y: ly });

const readOnline = (page) =>
  page.evaluate(() => {
    const s = window.__onlineMenu;
    if (!s) return { gone: true };
    return { gone: false, visible: s.visible, screen: s.screen, status: s.status, resolvedCode: s.resolvedCode, error: s.error };
  });

async function run(browser, profile) {
  const ctx = await browser.newContext({
    viewport: { width: profile.w, height: profile.h },
    deviceScaleFactor: 2,
    hasTouch: profile.touch,
    isMobile: profile.touch,
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  const tap = async (x, y) => { if (profile.touch) await page.touchscreen.tap(x, y); else await page.mouse.click(x, y); };

  let reachedLobby = false;
  let attempts = 0;
  let lastCode = null;
  const MAX = 6;
  for (attempts = 1; attempts <= MAX && !reachedLobby; attempts++) {
    await page.goto(BASE + '/', { waitUntil: 'load' });
    await page.waitForSelector('canvas', { state: 'attached', timeout: 30_000 });
    await page.waitForFunction(
      () => typeof window.__onlineMenu?.open === 'function' && Array.isArray(window.__mainMenu?.controls),
      undefined,
      { timeout: 20_000 },
    );
    await page.evaluate(() => document.fonts?.ready).catch(() => {});
    const menu = await page.evaluate(() => ({
      rotated: !!window.__mainMenu.rotated,
      logical: window.__mainMenu.logicalViewport,
      controls: window.__mainMenu.controls.map((c) => ({ kind: c.kind, p: c.physicalCenter })),
      innerW: window.innerWidth,
      isTouch: 'ontouchstart' in window || navigator.maxTouchPoints > 0,
    }));
    const onlineBtn = menu.controls.find((c) => c.kind === 'online');
    await tap(onlineBtn.p.x, onlineBtn.p.y);
    await sleep(400);
    const door = createDoorCenterLogical(menu.logical.width, menu.logical.height, menu.isTouch);
    const dp = toPhysical(door.x, door.y, menu.rotated, menu.innerW);
    await tap(dp.x, dp.y);

    // Reached the lobby when the online front-door tears down (visible=false /
    // gone) after a code resolved — the lobby view now owns the screen.
    const t0 = Date.now();
    let last = null;
    while (Date.now() - t0 < 9_000) {
      const s = await readOnline(page);
      last = s;
      if (s.resolvedCode) lastCode = s.resolvedCode;
      if (s.gone || s.visible === false) { reachedLobby = true; break; }
      if (s.error) break; // a hard error — reload and try again
      await sleep(200);
    }
    console.log(`[${profile.name}] attempt ${attempts}: reachedLobby=${reachedLobby} code=${lastCode} seam=${JSON.stringify(last)}`);
  }
  attempts -= 1;

  await sleep(700); // let the lobby paint a couple of frames
  const shot = join(OUT, `online-create-lobby-${profile.name}.png`);
  await page.screenshot({ path: shot });
  const finalSeam = await readOnline(page);
  await ctx.close();
  return { profile: profile.name, viewport: { w: profile.w, h: profile.h, touch: profile.touch }, attempts, reachedLobby, resolvedCode: lastCode, finalSeam, shot, pageErrors: errors };
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const results = {};
  const only = process.env.ONLY;
  try {
    if (!only || only === 'desktop') results.desktop = await run(browser, { name: 'desktop', w: 1000, h: 640, touch: false });
    if (!only || only === 'phone') results.phone = await run(browser, { name: 'phone', w: 390, h: 844, touch: true });
  } finally {
    await browser.close();
  }
  writeFileSync(join(OUT, 'r2-room-create-lobby-readback.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
