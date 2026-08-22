/**
 * capture-drop.mjs — the cut, both screens, on a0-131's clock. OWNER: Netcode
 * Engineer (a0-132).
 *
 * One room, two clients, one match, and then the joiner's link is cut. Frames at
 * the moment of the cut and thirty seconds after, on both screens, so they line up
 * with a0-131's `4-02-just-dropped` / `4-04-dropped-30s` pair. Profiles are
 * a0-131's, unchanged: HOST is desktop 1280x800 dpr2 pointer, JOINER is phone
 * 798x384 dpr2 touch.
 *
 * **The drop is EMULATED and this file says so in every artefact it writes.**
 * `context.setOffline(true)` is the same instrument a0-131 used. What it covers and
 * what it does not is measured here rather than assumed — see `wire` below, which
 * records the actual frames crossing the host's socket, so the claim "the room was
 * told, at t+Ns" is read off the wire and not off a screenshot.
 *
 *   A0_131_BASE=http://localhost:4341 node .../capture-drop.mjs
 */
import { launch, client, doors, readback, sleep, DESKTOP, PHONE } from './lib.mjs';
import { overlay, presence, link, SHOTS } from './lib.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const TAG = process.env.A0_132_TAG ?? 'run';
const shot = async (page, name) => { mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: join(SHOTS, `${TAG}-${name}.png`) }); };
const note = (name, data) => { mkdirSync(SHOTS, { recursive: true }); writeFileSync(join(SHOTS, `${TAG}-${name}.json`), `${JSON.stringify(data, null, 2)}\n`); };
const both = async (h, j, name) => { await Promise.all([shot(h, `${name}-host`), shot(j, `${name}-joiner`)]); };
const state = async (p) => ({ overlay: await overlay(p), presence: await presence(p), link: await link(p) });
const log = (...a) => console.log(...a);

const b = await launch();
const host = await client(b, DESKTOP, 'host');
const joiner = await client(b, PHONE, 'joiner');

/**
 * Every roster message that reaches the HOST's socket, with the time it landed.
 * Read off the WebSocket itself (CDP), not off a game seam: the question "was the
 * room told, and when" is a question about the wire, and answering it from the
 * client's own state would be answering it from the thing under test.
 */
const wire = [];
let cutAt = 0;
host.on('websocket', (ws) => {
  ws.on('framereceived', ({ payload }) => {
    if (typeof payload !== 'string') return; // snapshots are binary; roster is JSON
    for (const type of ['playerSubstituted', 'playerReclaimed']) {
      if (payload.includes(`"${type}"`)) wire.push({ type, atMs: cutAt ? Date.now() - cutAt : null, payload: payload.slice(0, 200) });
    }
  });
});

await doors(host); await host.waitForFunction(() => window.__mainMenu?.screen === 'online');
await doors(joiner); await joiner.waitForFunction(() => window.__mainMenu?.screen === 'online');
await host.evaluate(() => window.__onlineMenu.create());
await host.waitForFunction(() => window.__lobby?.visible === true, undefined, { timeout: 30_000 });
const code = await host.evaluate(() => window.__lobby.room);
log('ROOM', code);

await joiner.evaluate(() => window.__onlineMenu.join());
await sleep(joiner, 400);
await joiner.evaluate(() => window.__onlineMenu.setJoinMode('code'));
for (const ch of code) { await joiner.evaluate((c) => window.__onlineMenu.typeCode(c), ch); await sleep(joiner, 90); }
await joiner.evaluate(() => window.__onlineMenu.submit());
await joiner.waitForFunction(() => window.__lobby?.visible === true, undefined, { timeout: 30_000 });
log('both in lobby; humans =', (await readback(host)).lobby.humanCount);

await host.evaluate(() => window.__lobby.rush());
await host.waitForFunction(() => window.__mainMenu?.matchStarted === true, undefined, { timeout: 60_000 });
await joiner.waitForFunction(() => window.__mainMenu?.matchStarted === true, undefined, { timeout: 60_000 });
log('match started');
await sleep(host, 4000);

await both(host, joiner, '01-before-cut');
note('01-before-cut', { host: await state(host), joiner: await state(joiner) });

// --- THE CUT (emulated: the joiner's whole browser context goes offline) ----
cutAt = Date.now();
await joiner.__ctx.setOffline(true);
log('joiner offline at t0');
await both(host, joiner, '02-at-cut');
note('02-at-cut', { emulated: true, atMs: Date.now() - cutAt, host: await state(host), joiner: await state(joiner) });

// 08s: past the room's own silence window, so the substitution has landed and the
// host's banner is still inside its five-second telling. 30s: a0-131's instant.
for (const at of [8, 30]) {
  while (Date.now() - cutAt < at * 1000) await sleep(host, 200);
  const label = `${String(at).padStart(2, '0')}s`;
  await both(host, joiner, `03-${label}`);
  const snap = { emulated: true, atMs: Date.now() - cutAt, wire: [...wire], host: await state(host), joiner: await state(joiner) };
  note(`03-${label}`, snap);
  log(`t+${at}s joiner.overlay.shown=${snap.joiner.overlay?.shown} title=${JSON.stringify(snap.joiner.overlay?.title)} | wire=${JSON.stringify(wire)}`);
}

note('wire', { emulated: true, note: 'roster frames on the HOST socket, ms after the cut', frames: wire });
await b.close();
