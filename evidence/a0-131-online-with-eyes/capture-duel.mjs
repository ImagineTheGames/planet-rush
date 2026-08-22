/**
 * evidence/a0-131-online-with-eyes/capture-duel.mjs — the rendezvous, and the
 * shot fired by the other player. OWNER: QA Manager (a0-131).
 *
 * Brief items 2 and 3 both need something no earlier sweep has had on film: TWO
 * ships in ONE frame, on BOTH screens. That cannot be staged at the spawns. One
 * world unit is one CSS pixel (`src/ui/viewport.ts`), so the desktop sees 1280
 * units across and the phone 798, and The Ring at two seats spawns the seats 1728
 * apart (`src/sim/maps.ts`, computed) - each player's opponent is off the edge of
 * the glass by construction.
 *
 * So both ships are flown to a rendezvous either side of the world centre
 * (1200,1200): open space, out of reach of either station's guns, ~250 units
 * apart. Every leg is a real click / a real tap on the shipped `Click anywhere -
 * Move or attack` control, one leg at a time, waited out - a click issued before
 * the ship arrives only replaces the waypoint.
 *
 * The burst is then as fast as two screenshots can be taken; the pair is issued
 * and awaited together, which is NOT a synchronised capture.
 *
 *   node evidence/a0-131-online-with-eyes/capture-duel.mjs
 */
import { launch, client, doors, readback, frame, note, bothFrames, DESKTOP, PHONE, sleep } from './lib.mjs';

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
await bothFrames(host, joiner, 'D-00-spawn');
note('D-00-spawn', { room: code, host: await readback(host), joiner: await readback(joiner) });

// The rendezvous. Seat 0's ship starts at world (1968,1200), seat 1's at
// (432,1200); the aim is (1325,1200) and (1075,1200) - 250 apart, either side of
// the centre. Each click's distance is (screen centre - click x) world units.
await host.mouse.click(14, 400);      // 1968 -> 1342
await joiner.touchscreen.tap(790, 192); // 432 -> 823
await sleep(host, 9000);
await bothFrames(host, joiner, 'D-01-leg1');
await host.mouse.click(623, 400);     // 1342 -> 1325
await joiner.touchscreen.tap(651, 192); // 823 -> 1075
await sleep(host, 7000);
await bothFrames(host, joiner, 'D-02-arrived');
note('D-02-arrived', { host: await readback(host), joiner: await readback(joiner) });

// --- the burst: the same seconds of the same fight, from both ends of the wire
for (let i = 0; i < 24; i++) {
  await bothFrames(host, joiner, `D-shot-${String(i).padStart(2, '0')}`);
}
note('D-shot', { host: await readback(host), joiner: await readback(joiner) });
await sleep(host, 1500);
await bothFrames(host, joiner, 'D-03-after');
await b.close();
console.log('DONE');
