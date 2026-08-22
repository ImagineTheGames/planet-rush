/**
 * evidence/a0-131-online-with-eyes/capture-together.mjs — brief items 2 and 3:
 * both clients in one match at one moment, and a shot fired by the OTHER player.
 * OWNER: QA Manager (a0-131).
 *
 * The approach is a MEASURED recipe rather than arithmetic, because three
 * arithmetic stagings failed (see `./capture-shots.mjs` and this branch's working
 * note): seven clicks at the left edge two seconds apart leaves the host about
 * 420 world units from the stationary joiner, both alive, both firing. One more
 * short click closes it to roughly a hundred.
 *
 * The phone's VIEW control is then pressed for real - twice, 1x -> 1.5x -> 2x -
 * at the rect `src/ui/zoom-control.ts` `zoomControlBounds(798,384,true)` reports,
 * because the same standoff is a different picture on a screen that shows 798
 * world units and one that shows 1596, and which of those a phone player is
 * looking at decides whether they can see who is shooting them.
 *
 *   node evidence/a0-131-online-with-eyes/capture-together.mjs
 */
import { launch, client, doors, readback, note, frame, bothFrames, DESKTOP, PHONE, sleep } from './lib.mjs';

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
await bothFrames(host, joiner, 'T-00-spawn');
note('T-00-spawn', { room: code, host: await readback(host), joiner: await readback(joiner) });

// The measured approach. The joiner never touches a control.
for (let i = 0; i < 7; i++) { await host.mouse.click(14, 400); await sleep(host, 2000); }
await sleep(host, 1500);
await bothFrames(host, joiner, 'T-01-standoff');
for (let i = 0; i < 8; i++) await bothFrames(host, joiner, `T-02-standoff-burst-${String(i).padStart(2, '0')}`);

// One short hop to close it.
await host.mouse.click(340, 400);
await sleep(host, 5000);
await bothFrames(host, joiner, 'T-03-close');
note('T-03-close', { host: await readback(host), joiner: await readback(joiner) });
for (let i = 0; i < 26; i++) await bothFrames(host, joiner, `T-04-close-burst-${String(i).padStart(2, '0')}`);

// The phone's own VIEW control, pressed twice: 1x -> 1.5x -> 2x.
await joiner.touchscreen.tap(750, 85);
await sleep(joiner, 700);
await frame(joiner, 'T-05-view-1p5');
await joiner.touchscreen.tap(750, 85);
await sleep(joiner, 700);
await bothFrames(host, joiner, 'T-06-view-2x');
note('T-06-view-2x', { host: await readback(host), joiner: await readback(joiner) });
for (let i = 0; i < 20; i++) await bothFrames(host, joiner, `T-07-2x-burst-${String(i).padStart(2, '0')}`);
await b.close();
console.log('DONE');
