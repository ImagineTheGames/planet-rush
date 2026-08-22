/**
 * evidence/a0-131-online-with-eyes/capture-fire.mjs — brief item 3, the shot
 * itself. OWNER: QA Manager (a0-131).
 *
 * `./capture-together.mjs` got the two ships onto one screen and proved a thing
 * this brief needs anyway: at ~420 world units apart NOBODY FIRES - eight
 * consecutive frames with both hulls unchanged at 12/50 and 15/50. Weapons range
 * is shorter than that, so a burst taken there is a burst of two ships ignoring
 * each other.
 *
 * It also settled a direction that two runs got backwards: seven clicks at the
 * left edge carry the host PAST the joiner, so on the host's screen the joiner is
 * to the RIGHT and closing means clicking right, not left.
 *
 * So: the measured approach, then one 300-unit hop EAST onto the joiner, then a
 * long burst on both clients while they are inside each other's range.
 *
 *   node evidence/a0-131-online-with-eyes/capture-fire.mjs
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
for (let i = 0; i < 7; i++) { await host.mouse.click(14, 400); await sleep(host, 2000); }
await sleep(host, 1500);
await bothFrames(host, joiner, 'F-00-standoff');

// EAST, onto the joiner. Two 150-unit hops so a burst is taken on the way in as
// well as at the end - the frame where they come into range is the one that
// matters, and it cannot be predicted.
for (const [n, dx] of [[1, 150], [2, 150], [3, 100]]) {
  await host.mouse.click(640 + dx, 400);
  await sleep(host, 3500);
  await bothFrames(host, joiner, `F-0${n}-hop`);
  for (let i = 0; i < 10; i++) await bothFrames(host, joiner, `F-0${n}-burst-${String(i).padStart(2, '0')}`);
}
note('F-end', { room: code, host: await readback(host), joiner: await readback(joiner) });
for (let i = 0; i < 24; i++) await bothFrames(host, joiner, `F-04-burst-${String(i).padStart(2, '0')}`);
await b.close();
console.log('DONE');
