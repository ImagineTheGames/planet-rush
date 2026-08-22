/**
 * evidence/a0-134-see-what-shoots-you/capture-together.mjs — the a0-131 pair,
 * re-staged. OWNER: UI Engineer (a0-134).
 *
 * a0-131 item 2, photographed again against a bundle of THIS branch, and against
 * a bundle of `origin/main` for the same recipe, so the two plates differ in one
 * thing only: whether the phone's camera is allowed to be on a view that does not
 * contain what is shooting it.
 *
 * The recipe is a0-131's, verbatim and for that reason: seven clicks at the left
 * edge two seconds apart leaves the host ~420 world units from the stationary
 * joiner, both alive, both firing; one more short click closes it to roughly a
 * hundred. It was arrived at by measurement over three failed arithmetic
 * stagings (see a0-131's own header), and re-deriving it here would be measuring
 * a re-stage against a new ruler.
 *
 * THE ONE DIFFERENCE, and it is the finding: **the joiner never touches its VIEW
 * control.** a0-131 had to press it twice for the attacker to be drawn. This
 * capture presses nothing — whatever the phone shows is what the shipped default
 * gives a player who has touched nothing.
 *
 * No `?freeze=1` (it hides the build stamp) and no `?debug=1` (it skips the main
 * menu, so there is no online path at all) — a0-131's rules, unchanged.
 *
 *   A0_131_BASE=http://localhost:4319 LABEL=before node …/capture-together.mjs
 *   A0_131_BASE=http://localhost:4320 LABEL=after  node …/capture-together.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { launch, client, doors, readback, sleep, DESKTOP, PHONE, SHOTS } from './lib.mjs';

const LABEL = process.env.LABEL ?? 'after';
const tag = (n) => `${LABEL}-${n}`;

/** a0-131's `frame`/`note`, re-pointed at THIS brief's shots/ and tagged with the
 *  bundle under the camera, so a before plate and an after plate can never be
 *  confused for one another on disk. */
async function frame(page, name) {
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: join(SHOTS, `${tag(name)}.png`) });
}
function note(name, data) {
  mkdirSync(SHOTS, { recursive: true });
  writeFileSync(join(SHOTS, `${tag(name)}.json`), `${JSON.stringify(data, null, 2)}\n`);
}
async function bothFrames(host, joiner, name) {
  // Issued together and awaited together. That is TWO CONCURRENT CAPTURES tens of
  // milliseconds apart, not a hardware-synchronised one, and no caption may call
  // it one (a0-131's rule, kept).
  await Promise.all([frame(host, `${name}-host`), frame(joiner, `${name}-joiner`)]);
}

const b = await launch();
const host = await client(b, DESKTOP, 'host');
const joiner = await client(b, PHONE, 'joiner');
await doors(host);
await host.waitForFunction(() => window.__mainMenu?.screen === 'online');
await host.evaluate(() => window.__onlineMenu.create());
await host.waitForFunction(() => window.__lobby?.visible === true, undefined, { timeout: 30_000 });
const code = await host.evaluate(() => window.__lobby.room);
await doors(joiner);
await joiner.waitForFunction(() => window.__mainMenu?.screen === 'online');
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
console.log('ROOM', code, 'LABEL', LABEL);
await bothFrames(host, joiner, 'V-00-spawn');
note('V-00-spawn', { room: code, label: LABEL, host: await readback(host), joiner: await readback(joiner) });

// a0-131's measured approach. The joiner never touches a control — not the stick,
// and above all not the VIEW chip.
for (let i = 0; i < 7; i++) {
  await host.mouse.click(14, 400);
  await sleep(host, 2000);
}
await sleep(host, 1500);
await bothFrames(host, joiner, 'V-01-standoff');
note('V-01-standoff', { host: await readback(host), joiner: await readback(joiner) });
for (let i = 0; i < 8; i++) {
  await bothFrames(host, joiner, `V-02-standoff-burst-${String(i).padStart(2, '0')}`);
}

// One short hop to close it — the frames a0-131 read its finding off.
await host.mouse.click(340, 400);
await sleep(host, 5000);
await bothFrames(host, joiner, 'V-03-close');
note('V-03-close', { host: await readback(host), joiner: await readback(joiner) });
for (let i = 0; i < 26; i++) {
  await bothFrames(host, joiner, `V-04-close-burst-${String(i).padStart(2, '0')}`);
}
await b.close();
console.log('DONE', LABEL);
