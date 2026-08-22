/**
 * evidence/a0-131-online-with-eyes/capture-remote-shot2.mjs — brief item 3, with
 * the roles the way round that this harness can actually drive.
 * OWNER: QA Manager (a0-131).
 *
 * `./capture-remote-shot.mjs` tried to make the PHONE the shooter and failed on
 * the harness rather than on the game: four `touchscreen.tap`s at the right edge,
 * 5.5 s apart, left the joiner's ship exactly where it spawned (MATCH 0:38, still
 * docked). Repeated taps at ~1.8 s do move it, single spaced taps did not, and
 * chasing that difference is not what this brief is for.
 *
 * So the HOST shoots - it is driven with `mouse.click`, which is reliable - and
 * the PHONE watches at VIEW 2x, where a ship 400-odd world units away is on
 * screen. From the phone's seat every one of those bolts is ANOTHER PLAYER'S
 * shot, which is the developer's report from the reporting end:
 *   *"other players' shots don't follow the direction they were fired in."*
 * Both clients are screencast, so what is compared is what each compositor drew.
 *
 *   node evidence/a0-131-online-with-eyes/capture-remote-shot2.mjs
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { launch, client, doors, readback, note, bothFrames, SHOTS, DESKTOP, PHONE, sleep } from './lib.mjs';

const CAST = join(SHOTS, 'shot-cast');
mkdirSync(CAST, { recursive: true });

const measureFps = (page) => page.evaluate(() => new Promise((res) => {
  let n = 0; const t0 = performance.now();
  const tick = () => { n++; if (performance.now() - t0 < 2000) requestAnimationFrame(tick); else res(+(n / ((performance.now() - t0) / 1000)).toFixed(1)); };
  requestAnimationFrame(tick);
}));

async function startCast(page, tag, sink) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Page.startScreencast', { format: 'png', quality: 100, everyNthFrame: 1 });
  cdp.on('Page.screencastFrame', async (f) => {
    sink.push({ tag, n: sink.filter((x) => x.tag === tag).length, ts: f.metadata.timestamp, data: f.data });
    try { await cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }); } catch { /* closed */ }
  });
  return cdp;
}

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
console.log('ROOM', code, '| rAF fps host', await measureFps(host), 'joiner', await measureFps(joiner));

// The phone widens its view first, so the whole approach is on its screen.
await joiner.touchscreen.tap(750, 85); await sleep(joiner, 600);
await joiner.touchscreen.tap(750, 85); await sleep(joiner, 600);
console.log('phone view set');

for (let i = 0; i < 7; i++) { await host.mouse.click(14, 400); await sleep(host, 2000); }
await sleep(host, 1500);
await host.mouse.click(640 + 150, 400);
await sleep(host, 4000);
await bothFrames(host, joiner, 'X-00-in-range');
note('X-00-in-range', { room: code, host: await readback(host), joiner: await readback(joiner) });

// PLAIN SCREENSHOTS, not the screencast, and that is the point: this client
// renders at a MEASURED 2.7-2.8 rAF frames a second in this headless lane, and a
// `bothFrames()` pair costs about the same, so a screenshot burst loses almost
// nothing against the compositor - while the phone's screencast frames come back
// 1596x384 inside a 1596x768 canvas, horizontally stretched 2x, which is a frame
// no angle may ever be measured off.
for (let round = 0; round < 7; round++) {
  await host.mouse.click(640 + 120, 400);   // hold the attack order on the target
  for (let k = 0; k < 7; k++) await bothFrames(host, joiner, `X-fire-${round}-${k}`);
}
const frames = [];
const ch = await startCast(host, 'host', frames);
const cj = await startCast(joiner, 'joiner', frames);
await sleep(host, 4000);
try { await ch.send('Page.stopScreencast'); } catch {}
try { await cj.send('Page.stopScreencast'); } catch {}
await sleep(host, 400);
const index = [];
for (const f of frames) {
  const name = `${f.tag}-${String(f.n).padStart(4, '0')}`;
  writeFileSync(join(CAST, `${name}.png`), Buffer.from(f.data, 'base64'));
  index.push({ name, tag: f.tag, ts: f.ts });
}
writeFileSync(join(CAST, 'index.json'), `${JSON.stringify(index, null, 1)}\n`);
const per = {}; for (const f of index) per[f.tag] = (per[f.tag] ?? 0) + 1;
console.log('cast frames', JSON.stringify(per));
await bothFrames(host, joiner, 'X-01-after');
note('X-01-after', { host: await readback(host), joiner: await readback(joiner) });
await b.close();
console.log('DONE');
