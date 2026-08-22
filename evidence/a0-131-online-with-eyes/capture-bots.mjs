/**
 * evidence/a0-131-online-with-eyes/capture-bots.mjs — brief item 6: a bots-only
 * online match. OWNER: QA Manager (a0-131).
 *
 * The developer's question is not "do bots work" - it is *"if I start a match
 * with only bots, am I still online?"* That is a question about STATE, so the
 * answer has to be read off things a player can see: the JOIN CODE on the lobby,
 * the server suffix on the build badge, and whether the room is listed for other
 * people to walk into. A second client BROWSES for it here for exactly that
 * reason - a room nobody else can see is not online in the sense that was asked.
 *
 * The seats are cycled to BOT by PRESSING the drawn seat-state control at the
 * physical point the seam reports, not by calling a lever: `__lobby.seatStates`
 * is a read-back, and u5's whole defect was a control that was modelled and never
 * drawn.
 *
 *   node evidence/a0-131-online-with-eyes/capture-bots.mjs
 */
import { launch, client, doors, readback, frame, note, DESKTOP, PHONE, sleep, ALLOCATOR } from './lib.mjs';

const b = await launch();
const host = await client(b, DESKTOP, 'host');
await doors(host); await host.waitForFunction(() => window.__mainMenu?.screen === 'online');
await host.evaluate(() => window.__onlineMenu.create());
await host.waitForFunction(() => window.__lobby?.visible === true, undefined, { timeout: 30_000 });
await sleep(host, 800);
const code = await host.evaluate(() => window.__lobby.room);
console.log('ROOM', code);
await frame(host, '6-01-online-lobby-alone');
note('6-01-online-lobby-alone', await readback(host));

// Cycle seats 2..4 to BOT with real presses on the drawn control.
for (const idx of [1, 2, 3]) {
  for (let press = 0; press < 4; press++) {
    const st = await host.evaluate((i) => {
      const s = window.__lobby.seatStates[i];
      return { label: s.label, live: s.live, x: s.physicalCenter.x, y: s.physicalCenter.y };
    }, idx);
    if (st.label === 'BOT') break;
    await host.mouse.click(st.x, st.y);
    await sleep(host, 350);
  }
}
await sleep(host, 600);
await frame(host, '6-02-seats-set-to-bot');
note('6-02-seats-set-to-bot', await readback(host));
console.log('seats', JSON.stringify((await readback(host)).lobby.seatStates));

// Is this room visible to somebody else? A second client opens the BROWSE list.
const looker = await client(b, PHONE, 'looker');
await doors(looker); await looker.waitForFunction(() => window.__mainMenu?.screen === 'online');
await looker.evaluate(() => window.__onlineMenu.join());
await looker.evaluate(() => window.__onlineMenu.setJoinMode('browse'));
await sleep(looker, 7000);
await frame(looker, '6-03-browse-sees-the-room');
note('6-03-browse-sees-the-room', await readback(looker));
console.log('browse rows', JSON.stringify((await readback(looker)).online.browseRows));
console.log('allocator rooms:', await (await fetch(`${ALLOCATOR}/health`)).text());

// RUSH with only bots for company.
await host.evaluate(() => window.__lobby.rush());
await host.waitForFunction(() => window.__mainMenu?.matchStarted === true, undefined, { timeout: 40_000 });
await sleep(host, 4000);
await frame(host, '6-04-bots-only-match');
note('6-04-bots-only-match', await readback(host));
await sleep(host, 6000);
await frame(host, '6-05-bots-only-match-late');
note('6-05-bots-only-match-late', await readback(host));
console.log('badge in match', JSON.stringify((await readback(host)).badge));
console.log('allocator health:', await (await fetch(`${ALLOCATOR}/health`)).text());
await b.close();
console.log('DONE');
