/**
 * evidence/a0-131-online-with-eyes/capture-words.mjs — brief item 5's hard half:
 * *"confirm no 'claim' survives on any online screen."* OWNER: QA Manager (a0-131).
 *
 * A0-108 renamed `MAP · CLAIM HOLDER'S`. Confirming a rename is confirming an
 * ABSENCE, and an absence cannot be confirmed by looking at a screenshot and not
 * noticing something. So both clients walk every online screen with the
 * rasterisation recorder armed (`./words.mjs`) and the hunt runs over what was
 * actually drawn - on the HOST, who has the chip, and on the GUEST, who does not.
 *
 *   node evidence/a0-131-online-with-eyes/capture-words.mjs
 */
import { chromium } from '@playwright/test';
import { doors, readback, note, DESKTOP, PHONE, sleep, BASE } from './lib.mjs';
import { recordWords, takeWords, hunt } from './words.mjs';

const b = await chromium.launch();
async function armed(profile, label) {
  const ctx = await b.newContext({ viewport: { width: profile.width, height: profile.height }, deviceScaleFactor: profile.deviceScaleFactor, hasTouch: profile.hasTouch, isMobile: profile.isMobile });
  const page = await ctx.newPage();
  await recordWords(page);
  await page.goto(`${BASE}/?gate=0`, { waitUntil: 'load' });
  await page.waitForSelector('canvas', { state: 'attached', timeout: 30_000 });
  await page.waitForFunction(() => typeof window.__onlineMenu?.create === 'function', undefined, { timeout: 30_000 });
  page.__label = label;
  return page;
}

const seen = { host: {}, joiner: {} };
const take = async (page, who, screen) => {
  const w = await takeWords(page);
  seen[who][screen] = w;
  const h = hunt(w, 'claim');
  console.log(`${who}/${screen}: drawn=${w.drawn.length} measured=${w.measured.length} claim-hits=${h.drawn.length + h.measured.length}`);
  if (h.drawn.length + h.measured.length) console.log('   HITS', JSON.stringify(h));
};

const host = await armed(DESKTOP, 'host');
const joiner = await armed(PHONE, 'joiner');
await sleep(host, 1200);
await take(host, 'host', 'main-menu'); await take(joiner, 'joiner', 'main-menu');

await doors(host); await host.waitForFunction(() => window.__mainMenu?.screen === 'online');
await doors(joiner); await joiner.waitForFunction(() => window.__mainMenu?.screen === 'online');
await sleep(host, 1200);
await take(host, 'host', 'doors'); await take(joiner, 'joiner', 'doors');

await host.evaluate(() => window.__onlineMenu.create());
await host.waitForFunction(() => window.__lobby?.visible === true, undefined, { timeout: 30_000 });
await sleep(host, 1500);
const code = await host.evaluate(() => window.__lobby.room);
await take(host, 'host', 'host-lobby');

await joiner.evaluate(() => window.__onlineMenu.join());
await sleep(joiner, 6000);              // let the BROWSE list poll and draw a row
await take(joiner, 'joiner', 'join-browse');
await joiner.evaluate(() => window.__onlineMenu.setJoinMode('code'));
for (const ch of code) await joiner.evaluate((c) => window.__onlineMenu.typeCode(c), ch);
await sleep(joiner, 600);
await take(joiner, 'joiner', 'join-keypad');
await joiner.evaluate(() => window.__onlineMenu.submit());
await joiner.waitForFunction(() => window.__lobby?.visible === true, undefined, { timeout: 30_000 });
await sleep(joiner, 1500);
await take(joiner, 'joiner', 'guest-lobby');
await take(host, 'host', 'host-lobby-2-humans');

// the two lobby sub-screens the host can open
await host.evaluate(() => window.__lobby.openMapSelect()); await sleep(host, 900);
await take(host, 'host', 'map-picker');
await host.evaluate(() => window.__lobby.closeScreen()); await sleep(host, 500);
await host.evaluate(() => window.__lobby.openShipSelect()); await sleep(host, 900);
await take(host, 'host', 'ship-picker');
await host.evaluate(() => window.__lobby.closeScreen()); await sleep(host, 500);

// and the match itself, both clients
await host.evaluate(() => window.__lobby.rush());
await host.waitForFunction(() => window.__mainMenu?.matchStarted === true, undefined, { timeout: 40_000 });
await joiner.waitForFunction(() => window.__mainMenu?.matchStarted === true, undefined, { timeout: 40_000 });
await sleep(host, 6000);
await take(host, 'host', 'match'); await take(joiner, 'joiner', 'match');

note('words-census', seen);
const all = [];
for (const who of ['host', 'joiner']) for (const [screen, w] of Object.entries(seen[who])) {
  for (const s of w.drawn) all.push({ who, screen, list: 'drawn', s });
  for (const s of w.measured) all.push({ who, screen, list: 'measured', s });
}
const hits = all.filter((r) => r.s.toLowerCase().includes('claim'));
console.log(`\nTOTAL rasterised strings recorded: ${all.length}`);
console.log(`"claim" hits across every online screen both clients walked: ${hits.length}`);
if (hits.length) console.log(JSON.stringify(hits, null, 1));
// The positive control: the words that DID ship in that slot.
for (const needle of ['VISIBILITY', "HOST'S", 'PUBLIC', 'MAP']) {
  const f = all.filter((r) => r.s.includes(needle));
  console.log(`  "${needle}" appears ${f.length}x, e.g. ${JSON.stringify(f.slice(0, 3).map((r) => `${r.who}/${r.screen}: ${r.s}`))}`);
}
note('words-hunt', { total: all.length, claimHits: hits });
await b.close();
console.log('DONE');
