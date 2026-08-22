/**
 * evidence/a0-131-online-with-eyes/capture-screencast.mjs — brief item 3 at the
 * frame rate a bolt actually lives at. OWNER: QA Manager (a0-131).
 *
 * `page.screenshot()` on two clients costs a few hundred milliseconds a pair, so
 * a "burst" is about three frames a second. Roughly a hundred pairs taken that way
 * across live combat - hulls dropping, 405 HP of damage dealt, a station destroyed
 * - caught NO projectile in flight. That is not a finding, it is a sampling rate:
 * a bolt that crosses 250 world units in a third of a second is very likely to
 * fall between two frames taken a third of a second apart.
 *
 * So this one drives CDP `Page.startScreencast` on BOTH clients at once and keeps
 * every frame the browser compositor emits, with the compositor's own timestamp
 * beside it. That is the instrument the question needs: a bolt seen in consecutive
 * frames is a bolt whose heading can be READ, which is the whole of the
 * developer's report.
 *
 *   node evidence/a0-131-online-with-eyes/capture-screencast.mjs
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { launch, client, doors, readback, note, bothFrames, SHOTS, DESKTOP, PHONE, sleep } from './lib.mjs';

const CAST = join(SHOTS, 'cast');
mkdirSync(CAST, { recursive: true });

async function startCast(page, tag, sink) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Page.startScreencast', { format: 'png', quality: 100, everyNthFrame: 1 });
  cdp.on('Page.screencastFrame', async (f) => {
    sink.push({ tag, n: sink.length, ts: f.metadata.timestamp, data: f.data });
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

// Close to weapons range: the measured seven west, then east onto the joiner.
for (let i = 0; i < 7; i++) { await host.mouse.click(14, 400); await sleep(host, 2000); }
await sleep(host, 1500);
await host.mouse.click(640 + 150, 400);
await sleep(host, 3500);
await bothFrames(host, joiner, 'C-00-in-range');
note('C-00-in-range', { room: code, host: await readback(host), joiner: await readback(joiner) });

const frames = [];
const ch = await startCast(host, 'host', frames);
const cj = await startCast(joiner, 'joiner', frames);
await host.mouse.click(640 + 120, 400);   // press the attack home while recording
await sleep(host, 7000);
await host.mouse.click(640 + 120, 400);
await sleep(host, 7000);
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
const perTag = {};
for (const f of index) perTag[f.tag] = (perTag[f.tag] ?? 0) + 1;
console.log('cast frames', JSON.stringify(perTag));
await bothFrames(host, joiner, 'C-01-after');
note('C-01-after', { host: await readback(host), joiner: await readback(joiner) });
await b.close();
console.log('DONE');
