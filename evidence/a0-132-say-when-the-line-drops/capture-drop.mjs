/**
 * capture-drop.mjs — the cut, both screens, on a0-131's clock. OWNER: Netcode
 * Engineer (a0-132).
 *
 * One room, two clients, one match, and then the joiner's link is cut. Frames at
 * the moment of the cut and thirty seconds after, on both screens, so they are
 * comparable with a0-131's `4-02-just-dropped` / `4-04-dropped-30s` pair.
 *
 * The drop is EMULATED — `context.setOffline(true)`, the same instrument a0-131
 * used, and no attestation here calls it a real network cut.
 *
 *   node evidence/a0-132-say-when-the-line-drops/capture-drop.mjs
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
const t0 = Date.now();
await joiner.__ctx.setOffline(true);
log('joiner offline at t0');
await both(host, joiner, '02-at-cut');
note('02-at-cut', { atMs: Date.now() - t0, host: await state(host), joiner: await state(joiner) });

for (const at of [3, 8, 15, 30, 45]) {
  while (Date.now() - t0 < at * 1000) await sleep(host, 200);
  const label = `${String(at).padStart(2, '0')}s`;
  await both(host, joiner, `03-${label}`);
  const snap = { atMs: Date.now() - t0, host: await state(host), joiner: await state(joiner) };
  note(`03-${label}`, snap);
  log(`t+${at}s joiner.overlay.shown=${snap.joiner.overlay?.shown} title=${JSON.stringify(snap.joiner.overlay?.title)} | host.presence=${JSON.stringify(snap.host.presence?.lines)}`);
}

await b.close();
