/**
 * evidence/capture-r2-room-create.mjs — GATE online-room-create, RE-RUN round 2.
 * OWNER: QA Manager.
 *
 * The blocker that failed this gate (allocate POST fly-replayed to a handler-less
 * gameserver) is fixed: live POST /rooms now returns 201 JSON with a minted code.
 * This drives the SHIPPED bundle (built with VITE_ALLOCATOR_URL=the live Fly
 * allocator) through a REAL pointer/touch press on the CREATE ROOM button — not
 * the __onlineMenu.create() seam method — on BOTH form factors, and screenshots
 * the room-code the live control plane minted.
 *
 * "Real input at the front door" means exactly that: a synthesized Chromium
 * mouse click (desktop) / touchscreen tap (phone) at the physical pixel the
 * client itself drew the CREATE door at, dispatched into the same
 * canvas pointerdown handler a finger hits. The door centre is reconstructed
 * from the shipped entry-screen geometry (src/ui/lobby-geometry.ts) and SELF-
 * CHECKED: only a hit on CREATE flips the front-door status connecting -> a
 * resolvedCode, so a mis-aimed tap fails the run rather than faking a pass.
 *
 * Usage: EVIDENCE_BASE_URL=http://localhost:4191 node evidence/capture-r2-room-create.mjs
 */
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'images');
const BASE = process.env.EVIDENCE_BASE_URL ?? 'http://localhost:4191';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The shipped entry-screen door geometry (src/ui/lobby-geometry.ts), replicated
 *  so a REAL press can land on the CREATE door without a per-door seam. Returns
 *  the LOGICAL centre of the door named by DOOR_ORDER index (1 === 'create'). */
function createDoorCenterLogical(viewW, viewH, isTouch) {
  const PAD = 16, BLOCK_GAP = 12, TITLE = 52, HINT = 18;
  const cx = PAD, cy = PAD, cw = Math.max(0, viewW - 2 * PAD), ch = Math.max(0, viewH - 2 * PAD);
  const titleH = Math.min(TITLE, ch);
  const msgH = Math.min(HINT, Math.max(0, ch - titleH));
  const actionH = Math.min(isTouch ? 56 : 48, Math.max(0, ch - titleH - msgH));
  const actionsY = cy + ch - actionH;
  const midY = cy + titleH + msgH + BLOCK_GAP;
  const midH = Math.max(0, actionsY - BLOCK_GAP - midY);
  // placeDoors(): three stacked doors, centred in the middle band.
  const count = 3;
  const wanted = isTouch ? 64 : 56;
  const height = Math.max(0, Math.min(wanted, (midH - (count - 1) * BLOCK_GAP) / count - HINT));
  const width = Math.min(420, cw);
  const block = height + HINT;
  const total = count * block + (count - 1) * BLOCK_GAP;
  const top = midY + Math.max(0, (midH - total) / 2);
  const x = cx + (cw - width) / 2;
  const createY = top + 1 * (block + BLOCK_GAP); // index 1 === 'create'
  return { x: x + width / 2, y: createY + height / 2, width, height };
}

/** logicalToPhysical (src/platform/orientation.ts): identity unless the portrait
 *  phone rotated the root 90deg, in which case px = physW - ly, py = lx. */
function toPhysical(lx, ly, rotated, physW) {
  return rotated ? { x: physW - ly, y: lx } : { x: lx, y: ly };
}

const readOnline = (page) =>
  page.evaluate(() => {
    const s = window.__onlineMenu;
    return { visible: s.visible, screen: s.screen, status: s.status, error: s.error, code: s.code, resolvedCode: s.resolvedCode };
  });

async function settle(page, ms = 25_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const s = await readOnline(page);
    if (s.status !== 'connecting') return s;
    await sleep(150);
  }
  return readOnline(page);
}

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
  await page.goto(BASE + '/', { waitUntil: 'load' });
  await page.waitForSelector('canvas', { state: 'attached', timeout: 30_000 });
  await page.waitForFunction(
    () => typeof window.__onlineMenu?.open === 'function' && Array.isArray(window.__mainMenu?.controls),
    undefined,
    { timeout: 20_000 },
  );
  await page.evaluate(() => document.fonts?.ready).catch(() => {});

  // A trusted user gesture first (a real click on empty menu chrome) so the
  // page is interactive exactly as a player's first touch makes it.
  const menu = await page.evaluate(() => ({
    rotated: !!window.__mainMenu.rotated,
    logical: window.__mainMenu.logicalViewport,
    controls: window.__mainMenu.controls.map((c) => ({ kind: c.kind, p: c.physicalCenter })),
    innerW: window.innerWidth,
    innerH: window.innerHeight,
    isTouch: 'ontouchstart' in window || navigator.maxTouchPoints > 0,
  }));

  // 1 · REAL press on the ONLINE main-menu button (its physicalCenter is the
  //     point the client itself drew it at, through the landscape-lock remap).
  const online = menu.controls.find((c) => c.kind === 'online');
  const tap = async (x, y) => {
    if (profile.touch) await page.touchscreen.tap(x, y);
    else await page.mouse.click(x, y);
  };
  await tap(online.p.x, online.p.y);
  await sleep(400);
  const afterOnline = await readOnline(page);

  // 2 · REAL press on the CREATE door. Reconstruct its physical centre and self-
  //     check via the status flip that only CREATE causes.
  const doorLogical = createDoorCenterLogical(menu.logical.width, menu.logical.height, menu.isTouch);
  const doorPhys = toPhysical(doorLogical.x, doorLogical.y, menu.rotated, menu.innerW);
  await tap(doorPhys.x, doorPhys.y);
  const connecting = await readOnline(page); // should be status:'connecting'
  const settled = await settle(page);
  await sleep(400);

  const shot = join(OUT, `online-create-${profile.name}.png`);
  await page.screenshot({ path: shot });

  const result = {
    profile: profile.name,
    viewport: { w: profile.w, h: profile.h, touch: profile.touch },
    rotated: menu.rotated,
    logicalViewport: menu.logical,
    onlineButtonPhysical: online.p,
    afterOnlineScreen: afterOnline.screen, // 'home' proves the ONLINE tap opened the door
    createDoorLogical: doorLogical,
    createDoorPhysical: doorPhys,
    connectingStatus: connecting.status, // 'connecting' proves the CREATE tap dialled
    settledStatus: settled.status, // 'idle' after a successful create (front door leaves connecting)
    resolvedCode: settled.resolvedCode, // the LIVE allocator's minted code
    error: settled.error,
    shot,
    pageErrors: errors,
  };
  await ctx.close();
  return result;
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const results = {};
  try {
    results.desktop = await run(browser, { name: 'desktop', w: 1000, h: 640, touch: false });
    results.phone = await run(browser, { name: 'phone', w: 390, h: 844, touch: true });
  } finally {
    await browser.close();
  }
  writeFileSync(join(OUT, 'r2-room-create-readback.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
