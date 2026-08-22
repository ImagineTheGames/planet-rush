/**
 * capture-rejoin.mjs — the front door, photographed twice. OWNER: Netcode
 * Engineer (a0-133).
 *
 * One room, one live match, and then the phone's page goes away and comes back.
 * The same script runs against both builds; the only difference between the two
 * runs is which commit the bundle was built from, and the build stamp in the
 * corner of every frame says which.
 *
 *   A0_131_BASE=http://localhost:4342 A0_133_TAG=before node .../capture-rejoin.mjs
 *
 * The sequence, and why each step is the one the developer actually walked:
 *
 *  1. HOST (desktop) creates the room; JOINER (phone) reads the code off the host's
 *     screen and types it in; RUSH!; both are flying.
 *  2. The phone's radio dies — `context.setOffline(true)`, a0-131's instrument and
 *     an EMULATED drop, said so in every artefact this writes.
 *  3. The room notices and puts a bot on the controls. That is the state the match
 *     is in while the player is away, and the seat is held for as long as it runs
 *     (`server/room.ts` `HELD_FOR_MATCH`).
 *  4. **The tab is discarded.** The page is closed and rebuilt in the SAME browser
 *     context — a new heap, a new socket, nothing in memory, and the same origin's
 *     `localStorage`. This is what a slept phone comes back as, and it is the one
 *     step a0-131's staging did differently (it opened a new context, which is a
 *     different device).
 *  5. The player types the correct code into a live match, and the door answers.
 *  6. …and then a genuinely different device types the same correct code, and the
 *     door answers that too. Both answers are the finding; neither is complete
 *     without the other.
 */
import {
  launch, client, doors, readback, frame, note, bothFrames, sleep,
  DESKTOP, PHONE, SHOTS, samePageAgain, anotherDevice, typeCode, seatMemory,
} from './lib.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const TAG = process.env.A0_133_TAG ?? 'run';
const shot = async (page, name) => {
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: join(SHOTS, `${TAG}-${name}.png`) });
};
const jot = (name, data) => {
  mkdirSync(SHOTS, { recursive: true });
  writeFileSync(join(SHOTS, `${TAG}-${name}.json`), `${JSON.stringify(data, null, 2)}\n`);
};
const both = async (h, j, name) => { await Promise.all([shot(h, `${name}-host`), shot(j, `${name}-joiner`)]); };
const log = (...a) => console.log(...a);

/** The one sentence a screen can be reduced to for a console line. */
const answer = async (page) => {
  const r = await readback(page);
  return {
    screen: r.menu?.screen ?? null,
    matchStarted: r.menu?.matchStarted ?? null,
    online: r.online ? { screen: r.online.screen, title: r.online.title, status: r.online.status, error: r.online.error } : null,
    lobby: r.lobby ? { visible: r.lobby.visible, room: r.lobby.room, you: r.lobby.you, humanCount: r.lobby.humanCount } : null,
    badge: r.badge ?? null,
  };
};

const b = await launch();
const host = await client(b, DESKTOP, 'host');
let joiner = await client(b, PHONE, 'joiner');

// --- 1. one room, two clients, one live match -------------------------------
await doors(host); await host.waitForFunction(() => window.__mainMenu?.screen === 'online');
await doors(joiner); await joiner.waitForFunction(() => window.__mainMenu?.screen === 'online');
await host.evaluate(() => window.__onlineMenu.create());
await host.waitForFunction(() => window.__lobby?.visible === true, undefined, { timeout: 30_000 });
const code = await host.evaluate(() => window.__lobby.room);
log('ROOM', code);

await typeCode(joiner, code);
await shot(joiner, '01-code-typed-first-time');
await joiner.evaluate(() => window.__onlineMenu.submit());
await joiner.waitForFunction(() => window.__lobby?.visible === true, undefined, { timeout: 30_000 });
const seat = await joiner.evaluate(() => window.__lobby.you);
log('joiner seated at', seat, '— humans =', (await readback(host)).lobby.humanCount);

await host.evaluate(() => window.__lobby.rush());
await host.waitForFunction(() => window.__mainMenu?.matchStarted === true, undefined, { timeout: 60_000 });
await joiner.waitForFunction(() => window.__mainMenu?.matchStarted === true, undefined, { timeout: 60_000 });
await sleep(host, 4000);
await both(host, joiner, '02-live-match');
jot('02-live-match', {
  code, seat,
  // What the phone has written down while it is playing. On the before build this
  // is `null` — there was nowhere for the seat token to go (a0-133).
  seatMemory: await seatMemory(joiner),
  host: await answer(host), joiner: await answer(joiner),
});
log('seat memory while playing:', JSON.stringify(await seatMemory(joiner)));

// --- 2/3. the radio dies, and the room puts a bot on the controls -----------
// EMULATED, and this file says so in every artefact: `context.setOffline(true)` is
// a0-131's instrument, not a real cellular drop.
const cutAt = Date.now();
await joiner.__ctx.setOffline(true);
log('joiner offline');
await sleep(host, 10_000);
await both(host, joiner, '03-dropped-10s');
jot('03-dropped-10s', { emulated: true, measuredAtMs: Date.now() - cutAt, host: await answer(host), joiner: await answer(joiner) });

// --- 4. the tab is discarded, and the phone is picked back up ---------------
await joiner.__ctx.setOffline(false);
joiner = await samePageAgain(joiner, 'joiner-2');
log('the page is rebuilt; seat memory =', JSON.stringify(await seatMemory(joiner)));
await doors(joiner); await joiner.waitForFunction(() => window.__mainMenu?.screen === 'online');
await shot(joiner, '04-doors-again');

// --- 5. the correct code, into a live match ---------------------------------
await typeCode(joiner, code);
await shot(joiner, '05-code-typed-again');
jot('05-code-typed-again', { code, seatMemory: await seatMemory(joiner), joiner: await answer(joiner) });
await joiner.evaluate(() => window.__onlineMenu.submit());
await sleep(joiner, 3000);
await shot(joiner, '06-the-answer');
jot('06-the-answer', { measuredAtMs: Date.now() - cutAt, joiner: await answer(joiner) });
log('THE ANSWER (t+3s):', JSON.stringify(await answer(joiner)));

await sleep(joiner, 9000);
await both(host, joiner, '07-the-answer-late');
jot('07-the-answer-late', {
  measuredAtMs: Date.now() - cutAt,
  seatMemory: await seatMemory(joiner),
  host: await answer(host), joiner: await answer(joiner),
});
log('THE ANSWER (t+12s):', JSON.stringify(await answer(joiner)));

// --- 6. …and a different device, with the same correct code -----------------
// The door that must stay shut. Same four letters, same fleet, a real ticket, and
// nothing whatever to say the seat is theirs.
const stranger = await anotherDevice(b, PHONE, 'stranger');
await doors(stranger); await stranger.waitForFunction(() => window.__mainMenu?.screen === 'online');
await typeCode(stranger, code);
await shot(stranger, '08-stranger-code-typed');
await stranger.evaluate(() => window.__onlineMenu.submit());
await sleep(stranger, 4000);
await shot(stranger, '09-stranger-answer');
jot('09-stranger-answer', { seatMemory: await seatMemory(stranger), stranger: await answer(stranger) });
log('THE STRANGER:', JSON.stringify(await answer(stranger)));

await b.close();
log('DONE', TAG);
