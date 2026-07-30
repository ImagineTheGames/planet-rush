#!/usr/bin/env node
/**
 * evidence/probe-desktop-lobby.mjs — what is on the DESKTOP ONLINE LOBBY, step by
 * step? OWNER: QA Manager.
 *
 * WHY: on build 3d7cc6a, `probe-rush-reach.mjs` reports the desktop-online RUSH!
 * as un-PRESSABLE — but for a completely different reason than the round before:
 * nothing is over it any more (`elementFromPoint` answers CANVAS, and
 * `#pr-connect-trace` is not even in the document), yet the screenshot it took is
 * a FLAT BLACK 1280x800 frame. The same walk on a phone profile draws a full
 * lobby; the same desktop profile through the SOLO door draws a full arena. So
 * this walks the desktop online door one step at a time, shooting the screen and
 * reading the client's own seams after each, and collects every console message
 * and page error — to separate "the lobby did not start" from "the lobby is
 * there and paints nothing".
 *
 *   node evidence/probe-desktop-lobby.mjs
 */
import { chromium } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'images');
const BASE = process.env.EVIDENCE_BASE_URL ?? 'https://imaginethegames.github.io/planet-rush/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});
const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
const page = await context.newPage();
const errors = [];
const console_ = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => console_.push(`${m.type()}: ${m.text()}`.slice(0, 300)));

const report = { probe: 'desktop-online-lobby', base: BASE, capturedAt: new Date().toISOString(), steps: [] };

await page.goto(BASE, { waitUntil: 'load', timeout: 60_000 });
await page.waitForFunction(() => window.__mainMenu?.visible === true, undefined, { timeout: 60_000 });
const box = await page.locator('canvas').boundingBox();
const press = async (p) => page.mouse.click(box.x + p.x, box.y + p.y);

/** Shoot the screen, and ask the canvas itself how much of it is not black —
 *  a flat frame and a drawn frame are not distinguishable from a seam alone. */
async function step(name) {
  const shot = join(OUT, `desktop-lobby-${name}.png`);
  await page.screenshot({ path: shot });
  const seam = await page.evaluate(() => ({
    mainMenu: window.__mainMenu ? { visible: window.__mainMenu.visible, matchStarted: window.__mainMenu.matchStarted } : null,
    onlineMenu: window.__onlineMenu
      ? { visible: window.__onlineMenu.visible, screen: window.__onlineMenu.screen, status: window.__onlineMenu.status, error: window.__onlineMenu.error, code: window.__onlineMenu.resolvedCode }
      : null,
    lobby: window.__lobby
      ? { visible: window.__lobby.visible, room: window.__lobby.room, online: window.__lobby.online, isHost: window.__lobby.isHost, humanCount: window.__lobby.humanCount, counting: window.__lobby.counting, rush: window.__lobby.rushControl?.physicalCenter ?? null }
      : null,
    canvas: (() => {
      const c = document.querySelector('canvas');
      if (!c) return null;
      const r = c.getBoundingClientRect();
      return { w: c.width, h: c.height, cssW: Math.round(r.width), cssH: Math.round(r.height), display: getComputedStyle(c).display, visibility: getComputedStyle(c).visibility, opacity: getComputedStyle(c).opacity };
    })(),
    // Every element the document paints over the canvas, if any.
    overlays: [...document.body.children]
      .filter((el) => el.tagName !== 'CANVAS')
      .map((el) => {
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        return { tag: el.tagName, id: el.id || null, hidden: el.hidden, display: cs.display, z: cs.zIndex, rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } };
      })
      .filter((o) => o.rect.w > 0 && o.rect.h > 0),
  }));
  report.steps.push({ step: name, shot: `images/desktop-lobby-${name}.png`, ...seam });
  console.log(`\n[${name}]`, JSON.stringify(seam.lobby ?? seam.onlineMenu ?? seam.mainMenu));
  console.log('  overlays:', JSON.stringify(seam.overlays));
  return seam;
}

await step('01-main-menu');
await press(await page.evaluate(() => window.__mainMenu.controls.find((c) => c.kind === 'play').physicalCenter));
await page.waitForFunction(() => window.__onlineMenu?.visible === true, undefined, { timeout: 30_000 });
await sleep(800);
await step('02-entry-screen');
await press(await page.evaluate(() => window.__onlineMenu.doorControls.find((c) => c.kind === 'create').physicalCenter));
await sleep(2_500);
await step('03-connecting');
await page.waitForFunction(() => window.__lobby?.visible === true, undefined, { timeout: 45_000 });
await sleep(1_000);
await step('04-lobby-just-arrived');
await sleep(6_000);
await step('05-lobby-settled');
const rush = await page.evaluate(() => window.__lobby.rushControl.physicalCenter);
await press(rush);
await sleep(2_000);
await step('06-one-press-later');
await sleep(5_000);
await step('07-six-seconds-later');

report.pageErrors = errors;
report.console = console_.slice(-60);
await context.close();
await browser.close();
writeFileSync(join(OUT, 'desktop-lobby-probe.json'), JSON.stringify(report, null, 2));
console.log('\npage errors:', errors.length ? errors : '(none)');
