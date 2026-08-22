/**
 * evidence/a0-131-online-with-eyes/capture-match.mjs — the whole online match,
 * both clients, one run. OWNER: QA Manager (a0-131).
 *
 * ONE room serves brief items 1-5, because they are one story: a host creates it,
 * a joiner reads the code and types it in, both stand in the lobby, both fight in
 * the match, and then the joiner's link is cut and put back. Splitting them into
 * five runs would photograph five different rooms and quietly lose the only thing
 * this brief is about — whether the TWO clients agree.
 *
 * Every capture that matters is taken with `bothFrames()`: the two screenshot
 * requests issued together and awaited together. That is NOT a synchronised
 * capture and no attestation calls it one.
 *
 *   node evidence/a0-131-online-with-eyes/capture-match.mjs
 */
import { launch, client, doors, readback, frame, note, bothFrames, DESKTOP, PHONE, sleep, BASE } from './lib.mjs';

const b = await launch();
const host = await client(b, DESKTOP, 'host');
const joiner = await client(b, PHONE, 'joiner');
const log = (...a) => console.log(...a);

// --- 1. THE JOIN PATH, END TO END ------------------------------------------
// Every screen, on both clients, in the order a pair of players walks them.
await bothFrames(host, joiner, '1-01-main-menu');
note('1-01-main-menu', { host: await readback(host), joiner: await readback(joiner) });

await doors(host); await host.waitForFunction(() => window.__mainMenu?.screen === 'online');
await doors(joiner); await joiner.waitForFunction(() => window.__mainMenu?.screen === 'online');
await sleep(host, 600);
await bothFrames(host, joiner, '1-02-doors');
note('1-02-doors', { host: await readback(host), joiner: await readback(joiner) });

// HOST presses CREATE. The title is the connect narration; catch it mid-flight.
await host.evaluate(() => window.__onlineMenu.create());
await sleep(host, 120);
await frame(host, '1-03-host-creating');
note('1-03-host-creating', await readback(host));
await host.waitForFunction(() => window.__lobby?.visible === true, undefined, { timeout: 30_000 });
await sleep(host, 700);
await frame(host, '1-04-host-lobby-with-code');
const seamCode = await host.evaluate(() => window.__lobby.room);
note('1-04-host-lobby-with-code', { seamCode, ...(await readback(host)) });
log('ROOM (seam):', seamCode);

// JOINER walks the JOIN door: the browse list it opens on, then the keypad.
await joiner.evaluate(() => window.__onlineMenu.join());
await sleep(joiner, 900);
await frame(joiner, '1-05-joiner-join-browse');
note('1-05-joiner-join-browse', await readback(joiner));
await joiner.evaluate(() => window.__onlineMenu.setJoinMode('code'));
await sleep(joiner, 400);
await frame(joiner, '1-06-joiner-keypad-empty');
note('1-06-joiner-keypad-empty', await readback(joiner));
// Typed one character at a time, as a thumb would.
for (const ch of seamCode) { await joiner.evaluate((c) => window.__onlineMenu.typeCode(c), ch); await sleep(joiner, 160); }
await frame(joiner, '1-07-joiner-code-typed');
note('1-07-joiner-code-typed', { typed: seamCode, ...(await readback(joiner)) });
await joiner.evaluate(() => window.__onlineMenu.submit());
await sleep(joiner, 120);
await frame(joiner, '1-08-joiner-connecting');
note('1-08-joiner-connecting', await readback(joiner));
await joiner.waitForFunction(() => window.__lobby?.visible === true, undefined, { timeout: 30_000 });
await sleep(joiner, 900);

// --- 5. THE LOBBY BEFORE THE MATCH -----------------------------------------
await bothFrames(host, joiner, '5-01-lobby-both');
note('5-01-lobby-both', { host: await readback(host), joiner: await readback(joiner) });
log('lobby host  :', JSON.stringify((await readback(host)).lobby));
log('lobby joiner:', JSON.stringify((await readback(joiner)).lobby));

// RUSH!, and the countdown both clients are supposed to be counting.
await host.evaluate(() => window.__lobby.rush());
await sleep(host, 1500);
await bothFrames(host, joiner, '5-02-countdown-both');
note('5-02-countdown-both', { host: await readback(host), joiner: await readback(joiner) });
await sleep(host, 3000);
await bothFrames(host, joiner, '5-03-countdown-late-both');
await host.waitForFunction(() => window.__mainMenu?.matchStarted === true, undefined, { timeout: 40_000 });
await joiner.waitForFunction(() => window.__mainMenu?.matchStarted === true, undefined, { timeout: 40_000 });

// --- 2. BOTH CLIENTS IN ONE MATCH, THE SAME MOMENT --------------------------
await sleep(host, 2500);
await bothFrames(host, joiner, '2-01-spawn-both');
note('2-01-spawn-both', { host: await readback(host), joiner: await readback(joiner) });

// Bring them together. The HOST flies (real clicks on the shipped `Click anywhere
// - Move or attack` control); the JOINER never moves, so its camera is a fixed
// post and the host walks into its field of view.
for (let i = 0; i < 7; i++) { await host.mouse.click(14, 400); await sleep(host, 2000); }
await sleep(host, 1200);
await bothFrames(host, joiner, '2-02-closing-both');
// Two more short hops to put the host inside the phone's 798-unit-wide view.
for (let i = 0; i < 3; i++) { await host.mouse.click(210, 300); await sleep(host, 1400); }
await sleep(host, 800);
await bothFrames(host, joiner, '2-03-together-both');
note('2-03-together-both', { host: await readback(host), joiner: await readback(joiner) });

// --- 3. A SHOT FIRED BY THE OTHER PLAYER ------------------------------------
// A burst on both screens. The two clients are in weapons range of each other, so
// each frame pair holds the same bolts seen from both ends of the wire: local on
// the shooter's screen, remote on the other's.
for (let i = 0; i < 14; i++) {
  await bothFrames(host, joiner, `3-burst-${String(i).padStart(2, '0')}`);
  await sleep(host, 220);
}
note('3-burst', { host: await readback(host), joiner: await readback(joiner) });

// --- 4. DISCONNECT, AND REJOIN ----------------------------------------------
// An EMULATED drop: Playwright takes the joiner's whole browser context offline,
// which kills its WebSocket the way a phone losing its radio does. It is not a
// real network drop and no attestation calls it one.
await bothFrames(host, joiner, '4-01-before-drop');
await joiner.__ctx.setOffline(true);
log('joiner offline');
await sleep(host, 2500);
await bothFrames(host, joiner, '4-02-just-dropped');
note('4-02-just-dropped', { host: await readback(host), joiner: await readback(joiner) });
await sleep(host, 8000);
await bothFrames(host, joiner, '4-03-dropped-8s');
note('4-03-dropped-8s', { host: await readback(host), joiner: await readback(joiner) });
await sleep(host, 20000);
await bothFrames(host, joiner, '4-04-dropped-30s');
note('4-04-dropped-30s', { host: await readback(host), joiner: await readback(joiner) });

// Put the link back and see whether the SAME client recovers its seat.
await joiner.__ctx.setOffline(false);
log('joiner back online');
await sleep(host, 4000);
await bothFrames(host, joiner, '4-05-link-restored');
note('4-05-link-restored', { host: await readback(host), joiner: await readback(joiner) });
await sleep(host, 8000);
await bothFrames(host, joiner, '4-06-link-restored-12s');
note('4-06-link-restored-12s', { host: await readback(host), joiner: await readback(joiner) });

// And the developer's own case: a FRESH client typing the code while the match is
// still running - "i should be able to join back if the match is still on-going
// no matter what."
const rejoiner = await client(b, PHONE, 'rejoiner');
await doors(rejoiner); await rejoiner.waitForFunction(() => window.__mainMenu?.screen === 'online');
await rejoiner.evaluate(() => window.__onlineMenu.join());
await rejoiner.evaluate(() => window.__onlineMenu.setJoinMode('code'));
for (const ch of seamCode) { await rejoiner.evaluate((c) => window.__onlineMenu.typeCode(c), ch); await sleep(rejoiner, 120); }
await frame(rejoiner, '4-07-fresh-client-code-typed');
await rejoiner.evaluate(() => window.__onlineMenu.submit());
await sleep(rejoiner, 2500);
await frame(rejoiner, '4-08-fresh-client-answer');
note('4-08-fresh-client-answer', await readback(rejoiner));
await sleep(rejoiner, 6000);
await frame(rejoiner, '4-09-fresh-client-answer-late');
await frame(host, '4-09-host-at-that-moment');
note('4-09-fresh-client-answer-late', { rejoiner: await readback(rejoiner), host: await readback(host) });
log('rejoiner:', JSON.stringify((await readback(rejoiner)).online));
log('rejoiner lobby:', JSON.stringify((await readback(rejoiner)).lobby));

await b.close();
log('DONE');
