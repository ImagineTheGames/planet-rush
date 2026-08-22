/**
 * evidence/a0-131-online-with-eyes/capture-shots.mjs — brief item 3: a shot fired
 * by the OTHER player, on both screens. OWNER: QA Manager (a0-131).
 *
 * The developer's report is *"other players' shots don't follow the direction they
 * were fired in."* That is a question about a moving object across time, so the
 * capture is a burst rather than a frame, on both clients at once.
 *
 * Two earlier stagings failed and are written down so this one is not re-tried
 * blind: (a) a rendezvous at the world centre put both ships in The Ring's central
 * asteroid belt and they died together at MATCH 0:32; (b) parking by arithmetic
 * left the host 416 world units from the joiner, and the phone's half-width is
 * 399 - sixteen pixels short of a frame with both ships in it.
 *
 * So this one NUDGES. The joiner never moves, which makes its camera a fixed post
 * over its own station; the host closes in 100-unit steps and a frame pair is
 * taken after every step, all the way in. Somewhere in that ladder the two are
 * both on both screens and shooting, and the frames say where rather than the
 * arithmetic.
 *
 *   node evidence/a0-131-online-with-eyes/capture-shots.mjs
 */
import { launch, client, doors, readback, note, bothFrames, DESKTOP, PHONE, sleep } from './lib.mjs';

const b = await launch();
const host = await client(b, DESKTOP, 'host');
const joiner = await client(b, PHONE, 'joiner');
await doors(host); await host.waitForFunction(() => window.__mainMenu?.screen === 'online');
await host.evaluate(() => window.__onlineMenu.create());
await host.waitForFunction(() => window.__lobby?.visible === true, undefined, { timeout: 30_000 });
const code = await host.evaluate(() => window.__lobby.room);
await doors(joiner); await joiner.waitForFunction(() => window.__mainMenu?.screen === 'online');
await joiner.evaluate(() => window.__onlineMenu.join());
await joiner.evaluate(() => window.__onlineMenu.setJoinMode('code'));
for (const ch of code) await joiner.evaluate((c) => window.__onlineMenu.typeCode(c), ch);
await joiner.evaluate(() => window.__onlineMenu.submit());
await joiner.waitForFunction(() => window.__lobby?.visible === true, undefined, { timeout: 30_000 });
await sleep(host, 600);
await host.evaluate(() => window.__lobby.rush());
await host.waitForFunction(() => window.__mainMenu?.matchStarted === true, undefined, { timeout: 40_000 });
await joiner.waitForFunction(() => window.__mainMenu?.matchStarted === true, undefined, { timeout: 40_000 });
await sleep(host, 2500);
console.log('ROOM', code);

// Two long legs west, waited out one at a time.
for (let leg = 0; leg < 2; leg++) { await host.mouse.click(14, 400); await sleep(host, 10_000); }
await bothFrames(host, joiner, 'S-00-parked');
note('S-00-parked', { room: code, host: await readback(host), joiner: await readback(joiner) });

// The ladder in: 100 world units a step, three frame pairs after each.
for (let step = 0; step < 9; step++) {
  await host.mouse.click(540, 400);
  await sleep(host, 1600);
  for (let k = 0; k < 3; k++) await bothFrames(host, joiner, `S-${String(step).padStart(2, '0')}-${k}`);
  process.stdout.write(`${step} `);
}
console.log();
note('S-end', { host: await readback(host), joiner: await readback(joiner) });

// And a long dense burst wherever that left them - the fight itself.
for (let i = 0; i < 30; i++) await bothFrames(host, joiner, `S-burst-${String(i).padStart(2, '0')}`);
await b.close();
console.log('DONE');
