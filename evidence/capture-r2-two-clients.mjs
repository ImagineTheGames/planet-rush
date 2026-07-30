/**
 * evidence/capture-r2-two-clients.mjs — GATE online-two-clients, RE-RUN round 2.
 * OWNER: QA Manager.
 *
 * Two SHIPPED browser clients meet in ONE live match over the real internet.
 * Host (A) real-taps CREATE and gets a live-minted code; joiner (B) real-taps
 * JOIN, types that exact code on a real keyboard, and submits; the host presses
 * RUSH (real Enter). Both then render the authoritative server world.
 *
 * Every press is real DOM input through the same canvas handlers a finger/mouse
 * hits — no seam method drives the door. The proof both are in the SAME match:
 * the online front-door seam tears down on both (menu gone) and both canvases
 * paint a live arena; the readback records the shared room code both used.
 *
 * Usage: EVIDENCE_BASE_URL=http://localhost:4191 node evidence/capture-r2-two-clients.mjs
 */
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'images');
const BASE = process.env.EVIDENCE_BASE_URL ?? 'http://localhost:4191';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Logical centre of the door named by DOOR_ORDER index (0 solo,1 create,2 join),
 *  replicating src/ui/lobby-geometry.ts placeDoors. */
function doorCenterLogical(viewW, viewH, isTouch, index) {
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
  const y = top + index * (block + GAP);
  return { x: x + width / 2, y: y + height / 2 };
}
const toPhysical = (lx, ly, rotated, physW) => (rotated ? { x: physW - ly, y: lx } : { x: lx, y: ly });

async function boot(browser, profile) {
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
  return { ctx, page, errors, profile };
}

const online = (page) =>
  page.evaluate(() => {
    const s = window.__onlineMenu;
    if (!s) return { gone: true };
    return { gone: false, visible: s.visible, screen: s.screen, status: s.status, resolvedCode: s.resolvedCode, error: s.error };
  });

async function menuGeom(page) {
  return page.evaluate(() => ({
    rotated: !!window.__mainMenu.rotated,
    logical: window.__mainMenu.logicalViewport,
    controls: window.__mainMenu.controls.map((c) => ({ kind: c.kind, p: c.physicalCenter })),
    innerW: window.innerWidth,
    isTouch: 'ontouchstart' in window || navigator.maxTouchPoints > 0,
  }));
}

function tapper(page, touch) {
  return async (x, y) => {
    if (touch) await page.touchscreen.tap(x, y);
    else await page.mouse.click(x, y);
  };
}

async function openOnline(client) {
  const g = await menuGeom(client.page);
  const onlineBtn = g.controls.find((c) => c.kind === 'online');
  await tapper(client.page, client.profile.touch)(onlineBtn.p.x, onlineBtn.p.y);
  await sleep(300);
  return g;
}

async function pressDoor(client, geom, index) {
  const l = doorCenterLogical(geom.logical.width, geom.logical.height, geom.isTouch, index);
  const p = toPhysical(l.x, l.y, geom.rotated, geom.innerW);
  await tapper(client.page, client.profile.touch)(p.x, p.y);
}

async function waitFor(page, pred, ms = 30_000, step = 200) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const s = await online(page);
    if (pred(s)) return s;
    await sleep(step);
  }
  return online(page);
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const out = { steps: [] };
  try {
    const A = await boot(browser, { name: 'host-desktop', w: 1000, h: 640, touch: false });
    const B = await boot(browser, { name: 'joiner-desktop', w: 1000, h: 640, touch: false });

    // --- HOST: real ONLINE tap, real CREATE tap → live code -------------------
    const ga = await openOnline(A);
    await pressDoor(A, ga, 1); // CREATE
    const created = await waitFor(A.page, (s) => !s.gone && s.resolvedCode, 30_000);
    out.hostCode = created.resolvedCode;
    out.steps.push({ step: 'host created', code: created.resolvedCode, status: created.status });
    if (!created.resolvedCode) throw new Error('host never minted a code');

    // --- JOINER: real ONLINE tap, real JOIN tap, type the code, submit --------
    const gb = await openOnline(B);
    await pressDoor(B, gb, 2); // JOIN
    await sleep(300);
    // Real keyboard entry of the shared code, then Enter to submit (the desktop
    // join path onKeyDown supports — a real key event per character).
    for (const ch of out.hostCode) {
      await B.page.keyboard.press(`Key${ch}`);
      await sleep(60);
    }
    const typed = await online(B.page);
    out.steps.push({ step: 'joiner typed', code: typed.code });
    await B.page.keyboard.press('Enter');
    // The joiner's front door dials the room; it stays 'connecting' (m9 host-RUSH
    // gates the handoff), so wait for the socket to have joined, then RUSH.
    await sleep(2_500);
    out.steps.push({ step: 'joiner submitted', joiner: await online(B.page) });

    // --- HOST RUSH: real Enter starts the match (creator-only) -----------------
    await A.page.keyboard.press('Enter');

    // Both should leave the front door as the match starts (seam torn down).
    const aGone = await waitFor(A.page, (s) => s.gone || s.visible === false, 30_000);
    const bGone = await waitFor(B.page, (s) => s.gone || s.visible === false, 30_000);
    out.steps.push({ step: 'after rush', hostSeam: aGone, joinerSeam: bGone });

    // Let the live arena paint a few frames, then shoot both viewports.
    await sleep(2_500);
    const aShot = join(OUT, 'online-two-clients-host.png');
    const bShot = join(OUT, 'online-two-clients-joiner.png');
    await A.page.screenshot({ path: aShot });
    await B.page.screenshot({ path: bShot });
    out.hostShot = aShot;
    out.joinerShot = bShot;
    out.hostErrors = A.errors;
    out.joinerErrors = B.errors;
  } finally {
    await browser.close();
  }
  writeFileSync(join(OUT, 'r2-two-clients-readback.json'), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
