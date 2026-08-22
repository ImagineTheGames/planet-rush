/**
 * evidence/a0-131-online-with-eyes/capture-remote-shot.mjs — brief item 3, done
 * the way the game actually works. OWNER: QA Manager (a0-131).
 *
 * Four stagings of this item failed for one reason, and it is worth writing down
 * because it is a fact about the SHIPPED CONTROL, not about the harness: on the
 * default scheme the strip reads `Click anywhere - Move or attack`, and a ship
 * **only fires when it is ordered to**. A player who touches nothing never shoots.
 * Every earlier attempt parked an idle joiner next to the host and waited for a
 * fight that the idle client was never going to start - the host's tracer was on
 * screen the whole time and the joiner's hull never moved off 19/50.
 *
 * So the JOINER is the aggressor here: it flies to the host's station and is
 * ordered onto it, while the host sits at home and watches. Everything the host's
 * screen then shows of that attack is a REMOTE shot, which is the developer's
 * report exactly - *"other players' shots don't follow the direction they were
 * fired in."*
 *
 * Both clients are recorded with CDP `Page.startScreencast`, which yields the
 * frames the compositor actually produced. The client's own rAF rate is measured
 * in the same run and reported, because "no bolt in the frame" means nothing
 * until you know how many frames a second there were.
 *
 *   node evidence/a0-131-online-with-eyes/capture-remote-shot.mjs
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { launch, client, doors, readback, note, bothFrames, frame, SHOTS, DESKTOP, PHONE, sleep } from './lib.mjs';

const CAST = join(SHOTS, 'remote-cast');
mkdirSync(CAST, { recursive: true });

/** The client's OWN frame rate, measured over ~2 s of its own rAF callbacks. */
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
console.log('ROOM', code);
console.log('rAF fps  host', await measureFps(host), ' joiner', await measureFps(joiner));

// The joiner flies EAST to the host's station. Four legs of ~390 units, waited out.
for (let i = 0; i < 4; i++) { await joiner.touchscreen.tap(790, 192); await sleep(joiner, 5500); }
await sleep(joiner, 1500);
await bothFrames(host, joiner, 'R-00-arrived');
note('R-00-arrived', { room: code, host: await readback(host), joiner: await readback(joiner) });

const frames = [];
const ch = await startCast(host, 'host', frames);
const cj = await startCast(joiner, 'joiner', frames);
// The ORDER: taps onto the host's station / ship, which sit east of the joiner.
for (let round = 0; round < 6; round++) {
  await joiner.touchscreen.tap(700, 192);
  await sleep(joiner, 2500);
}
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
const per = {};
for (const f of index) per[f.tag] = (per[f.tag] ?? 0) + 1;
console.log('cast frames', JSON.stringify(per));
await bothFrames(host, joiner, 'R-01-after');
note('R-01-after', { host: await readback(host), joiner: await readback(joiner), fps: { host: await measureFps(host), joiner: await measureFps(joiner) } });
await b.close();
console.log('DONE');
