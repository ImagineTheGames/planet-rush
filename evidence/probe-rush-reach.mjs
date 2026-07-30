#!/usr/bin/env node
/**
 * evidence/probe-rush-reach.mjs — is the online lobby's RUSH! button PRESSABLE?
 * OWNER: QA Manager.
 *
 * The `online-feel` gate asks for a natural two-client live match walked through
 * the shipped front door. On the deployed build that walk stops dead at the last
 * step: the host presses RUSH! at the point the client itself reports drawing it,
 * and nothing happens — measured, repeatedly, on 2026-07-30 against build
 * 6888456. The same press actuates PLAY, CREATE ROOM, JOIN ROOM, every keypad
 * digit and SUBMIT, and the very same RUSH! control in the OFFLINE lobby starts a
 * match immediately. Only the ONLINE lobby's RUSH! is dead.
 *
 * This asks the browser rather than the test runner, the same way the phone
 * COPY LOG finding was settled (`probe-copylog-reach.mjs`): `elementFromPoint`
 * at the button's own centre. If something other than the game canvas answers,
 * that something is eating the press.
 *
 *   node evidence/probe-rush-reach.mjs [--json]
 */
import { chromium } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'images');
const BASE = process.env.EVIDENCE_BASE_URL ?? 'https://imaginethegames.github.io/planet-rush/';
const JSON_ONLY = process.argv.includes('--json');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});

async function boot(profile) {
  const context = await browser.newContext({
    viewport: { width: profile.width, height: profile.height },
    deviceScaleFactor: profile.dpr,
    hasTouch: profile.touch,
    isMobile: profile.touch,
  });
  const page = await context.newPage();
  await page.goto(BASE, { waitUntil: 'load', timeout: 60_000 });
  await page.waitForFunction(() => window.__mainMenu?.visible === true, undefined, { timeout: 60_000 });
  const box = await page.locator('canvas').boundingBox();
  const press = async (p) => {
    if (profile.touch) await page.touchscreen.tap(box.x + p.x, box.y + p.y);
    else await page.mouse.click(box.x + p.x, box.y + p.y);
  };
  return { page, box, press, context };
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

/** Walk PLAY → the named door, and report what sits over RUSH! in the lobby. */
async function check(name, profile, door) {
  const c = await boot(profile);
  await c.press(await menuPoint(c.page, 'play'));
  await c.page.waitForFunction(() => window.__onlineMenu?.visible === true, undefined, { timeout: 30_000 });
  await c.press(await doorPoint(c.page, door));
  await c.page.waitForFunction(() => window.__lobby?.visible === true, undefined, { timeout: 45_000 });
  // Give any lingering connect confirmation its full linger and then some.
  await sleep(6_000);

  const rush = await c.page.evaluate(() => window.__lobby.rushControl.physicalCenter);
  const at = await c.page.evaluate((pt) => {
    const el = document.elementFromPoint(pt.x, pt.y);
    const trace = document.getElementById('pr-connect-trace');
    const r = trace?.getBoundingClientRect?.() ?? null;
    const cs = trace ? getComputedStyle(trace) : null;
    return {
      elementAtRushCentre: el ? (el.id ? `${el.tagName}#${el.id}` : el.tagName) : null,
      connectTracePresent: !!trace,
      connectTraceHidden: trace ? trace.hidden : null,
      connectTraceRect: r ? { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } : null,
      connectTracePointerEvents: cs ? cs.pointerEvents : null,
      connectTraceDisplay: cs ? cs.display : null,
      connectTraceZIndex: cs ? cs.zIndex : null,
    };
  }, rush);

  // Now actually press it, and see whether the lobby reacts.
  await c.press(rush);
  await sleep(5_000);
  const after = await c.page.evaluate(() => ({
    counting: window.__lobby?.counting ?? null,
    started: window.__mainMenu?.matchStarted ?? null,
  }));
  await c.page.screenshot({ path: join(OUT, `rush-reach-${name}.png`) });
  await c.context.close();

  return {
    profile: name,
    door,
    rushCentre: rush,
    ...at,
    countingAfterPress: after.counting,
    startedAfterPress: after.started,
    PRESSABLE: after.counting === true || after.started === true,
  };
}

const results = [];
results.push(await check('desktop-online', { width: 1280, height: 800, dpr: 1, touch: false }, 'create'));
results.push(await check('desktop-offline', { width: 1280, height: 800, dpr: 1, touch: false }, 'solo'));
results.push(await check('phone-online', { width: 390, height: 844, dpr: 3, touch: true }, 'create'));
await browser.close();

const report = { probe: 'rush-reach', base: BASE, capturedAt: new Date().toISOString(), results };
writeFileSync(join(OUT, 'rush-reach.json'), JSON.stringify(report, null, 2));
if (JSON_ONLY) console.log(JSON.stringify(report, null, 2));
else {
  for (const r of results) {
    console.log(`\n${r.profile} (${r.door} door)`);
    console.log(`  RUSH! centre           ${r.rushCentre.x},${r.rushCentre.y}`);
    console.log(`  element at that point  ${r.elementAtRushCentre}`);
    console.log(`  connect trace present  ${r.connectTracePresent} hidden=${r.connectTraceHidden} rect=${JSON.stringify(r.connectTraceRect)}`);
    console.log(`  pointer-events         ${r.connectTracePointerEvents} display=${r.connectTraceDisplay} z=${r.connectTraceZIndex}`);
    console.log(`  PRESSABLE              ${r.PRESSABLE}`);
  }
}
