/**
 * evidence/a0-131-online-with-eyes/lib.mjs — the two clients, and the two things
 * every a0-131 capture does. OWNER: QA Manager (a0-131).
 *
 * a0-131 is the first sweep in this repo to point a camera at TWO clients in ONE
 * match, so this file exists to make "the host" and "the joiner" cheap to say.
 * Everything else is a0-96's rule kept through a0-99 and a0-111: `frame()` writes
 * the PNG, `note()` writes the JSON readback BESIDE it, and they are separate
 * calls on purpose — the attestation is written off the PNG, the JSON is only ever
 * a cross-check, and the day they disagree the image is the finding.
 *
 * The profiles are a0-111's, unchanged, so a finding here is comparable with every
 * earlier sweep rather than measured against a new ruler.
 */
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const HERE = dirname(fileURLToPath(import.meta.url));
export const SHOTS = join(HERE, 'shots');
export const BASE = process.env.A0_131_BASE ?? 'http://localhost:4318';
export const ALLOCATOR = process.env.A0_131_ALLOCATOR ?? 'http://127.0.0.1:8891';

/** a0-111's two profiles, unchanged. HOST is the desktop, JOINER is the phone. */
export const DESKTOP = { width: 1280, height: 800, deviceScaleFactor: 2, hasTouch: false, isMobile: false };
export const PHONE = { width: 798, height: 384, deviceScaleFactor: 2, hasTouch: true, isMobile: true };

export async function frame(page, name) {
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: join(SHOTS, `${name}.png`) });
}

export function note(name, data) {
  mkdirSync(SHOTS, { recursive: true });
  writeFileSync(join(SHOTS, `${name}.json`), `${JSON.stringify(data, null, 2)}\n`);
}

/** Both viewports as close to one instant as this harness can get them: the two
 *  screenshot requests are ISSUED together and awaited together. That is not a
 *  hardware-synchronised capture and no attestation may call it one — it is two
 *  concurrent captures, tens of milliseconds apart, and the manifest says so. */
export async function bothFrames(host, joiner, name) {
  await Promise.all([frame(host, `${name}-host`), frame(joiner, `${name}-joiner`)]);
}

/** A clean-booted client on the doors. NO `?freeze=1` — `src/main.ts` sets
 *  `buildBadge.visible = !flags.freeze`, so a frozen frame is one with the build
 *  stamp deliberately hidden (a0-111's rule). `?gate=0` opens the title gate only. */
export async function client(browser, profile, label) {
  const ctx = await browser.newContext({ viewport: { width: profile.width, height: profile.height }, deviceScaleFactor: profile.deviceScaleFactor, hasTouch: profile.hasTouch, isMobile: profile.isMobile });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log(`  [${label} pageerror]`, String(e).slice(0, 200)));
  await page.goto(`${BASE}/?gate=0`, { waitUntil: 'load' });
  await page.waitForSelector('canvas', { state: 'attached', timeout: 30_000 });
  await page.waitForFunction(() => typeof window.__onlineMenu?.create === 'function', undefined, { timeout: 30_000 });
  page.__label = label;
  page.__ctx = ctx;
  return page;
}

export const doors = (page) => page.evaluate(() => { window.__mainMenu.online(); });

/** Every seam this sweep reads, in one structured-cloneable lump. */
export const readback = (page) => page.evaluate(() => ({
  menu: window.__mainMenu ? { screen: window.__mainMenu.screen, matchStarted: window.__mainMenu.matchStarted } : null,
  online: window.__onlineMenu ? {
    visible: window.__onlineMenu.visible, screen: window.__onlineMenu.screen,
    status: window.__onlineMenu.status, title: window.__onlineMenu.title,
    error: window.__onlineMenu.error, notice: window.__onlineMenu.notice,
    code: window.__onlineMenu.code, resolvedCode: window.__onlineMenu.resolvedCode,
    joinMode: window.__onlineMenu.joinMode,
    browseRows: window.__onlineMenu.browseRows?.map((r) => ({ owner: r.owner, meta: r.meta, where: r.where, action: r.action, state: r.state, enabled: r.enabled })),
    browseStamp: window.__onlineMenu.browseStamp, browseEmpty: window.__onlineMenu.browseEmpty,
    regionLine: window.__onlineMenu.regionLine, regionPickerVisible: window.__onlineMenu.regionPickerVisible,
  } : null,
  lobby: window.__lobby ? {
    visible: window.__lobby.visible, online: window.__lobby.online, room: window.__lobby.room,
    you: window.__lobby.you, isHost: window.__lobby.isHost, humanCount: window.__lobby.humanCount,
    mode: window.__lobby.mode, size: window.__lobby.size, abundance: window.__lobby.abundance,
    claim: window.__lobby.claim, selectedClass: window.__lobby.selectedClass,
    seatStates: window.__lobby.seatStates?.map((s) => ({ index: s.index, label: s.label, live: s.live })),
    worldMapId: window.__lobby.worldMapId ?? null,
    worldCast: window.__lobby.worldCast ?? null,
  } : null,
  badge: window.__buildBadge ? { text: window.__buildBadge.text, visible: window.__buildBadge.visible, server: window.__buildBadge.server } : null,
}));

export const sleep = (page, ms) => page.waitForTimeout(ms);

export async function launch() {
  return chromium.launch();
}
