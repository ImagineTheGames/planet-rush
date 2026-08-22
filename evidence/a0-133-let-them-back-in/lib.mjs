/**
 * evidence/a0-133-let-them-back-in/lib.mjs — a0-131's two clients, plus the one
 * thing this brief needs that no earlier sweep did: **the same device, a second
 * page**. OWNER: Netcode Engineer (a0-133).
 *
 * The profiles, `frame`/`note`, `client()` and the doors helper are a0-131's,
 * re-exported unchanged so a frame here is comparable with a frame there.
 *
 * ── The distinction this whole capture turns on ─────────────────────────────
 * a0-131's rejoin staging opened a **new browser context** for its fresh client,
 * and a new context is a new `localStorage` — a different *device*, not a
 * returning player. That is the right instrument for the question it was asking
 * ("can anyone with the code walk in?") and the wrong one for the developer's:
 * their phone did not become a different phone while the screen was black. It got
 * a new *page*.
 *
 * So {@link samePageAgain} rebuilds the page inside the context that was already
 * there — a discarded tab coming back — and {@link anotherDevice} keeps a0-131's
 * new-context client under a name that says what it actually is. The capture uses
 * both, because "let the returning player in" is only the right fix if the other
 * one is still turned away.
 */
export { frame, note, bothFrames, doors, readback, sleep, launch, DESKTOP, PHONE, client, BASE }
  from '../a0-131-online-with-eyes/lib.mjs';
import { client, BASE } from '../a0-131-online-with-eyes/lib.mjs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const HERE = dirname(fileURLToPath(import.meta.url));
export const SHOTS = join(HERE, 'shots');

/**
 * **The phone, picked back up.** A fresh page in the *same* browser context: new
 * JavaScript heap, new socket, new session object, no in-memory anything — and the
 * same origin's `localStorage`, which is the only thing a returning player has and
 * the only thing this fix reads (`src/net/seat-memory`).
 *
 * The page that was there is closed first, exactly as a discarded tab is gone
 * before it is rebuilt.
 */
export async function samePageAgain(page, label) {
  const ctx = page.__ctx;
  await page.close();
  const next = await ctx.newPage();
  next.on('pageerror', (e) => console.log(`  [${label} pageerror]`, String(e).slice(0, 200)));
  await next.goto(`${BASE}/?gate=0`, { waitUntil: 'load' });
  await next.waitForSelector('canvas', { state: 'attached', timeout: 30_000 });
  await next.waitForFunction(() => typeof window.__onlineMenu?.create === 'function', undefined, { timeout: 30_000 });
  next.__label = label;
  next.__ctx = ctx;
  return next;
}

/** a0-131's fresh client, named for what it is: a **different device**, with no
 *  credential and nowhere one could have come from. The door must stay shut. */
export const anotherDevice = (browser, profile, label) => client(browser, profile, label);

/** Type a room code the way a thumb does, one key at a time, then submit. */
export async function typeCode(page, code, sleepMs = 120) {
  await page.evaluate(() => window.__onlineMenu.join());
  await page.waitForTimeout(400);
  await page.evaluate(() => window.__onlineMenu.setJoinMode('code'));
  for (const ch of code) {
    await page.evaluate((c) => window.__onlineMenu.typeCode(c), ch);
    await page.waitForTimeout(sleepMs);
  }
}

/** What this device has written down for the room, read straight out of the
 *  page's own `localStorage` — the credential, with the token redacted to its
 *  length, because an evidence file is a public artefact. */
export const seatMemory = (page) => page.evaluate(() => {
  const raw = window.localStorage.getItem('planet-rush:seat');
  if (raw === null) return null;
  try {
    const seat = JSON.parse(raw);
    return { room: seat.room, seat: seat.seat, tokenChars: String(seat.token ?? '').length, v: seat.v };
  } catch {
    return { unparseable: raw.slice(0, 40) };
  }
});
