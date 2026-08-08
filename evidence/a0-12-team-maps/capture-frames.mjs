/**
 * evidence/a0-12-team-maps/capture-frames.mjs — a0-12, the on-screen half.
 * OWNER: Gameplay Engineer.
 *
 * `capture-layouts.mjs` proves the geometry off the registry; this proves it
 * ARRIVED — the real bundle, the real renderer, the real backdrop. Four frames:
 *
 *   • `<id>-match.png` — a live 4v4 (`?debug=1&sides=2`) on each map at gameplay
 *     zoom, flying its ASSIGNED nebula (crescents → Iron Veil, line → Deep
 *     Ember). The `?debug=1` handle is read-only and publishes no world and no
 *     backdrop, so the sky is named from the registry and SHOWN in the frame
 *     rather than read back — said plainly here so nobody reads more into the
 *     printout than it earns. What IS read back is `shipWorld`, and it carries
 *     the claim: on `line` it reads (682.7, 1186.2), which is P0's spawn in the
 *     registry to the decimal (`line-layout.svg`), on the near half of a
 *     3200×2000 arena.
 *   • `lobby-4v4-<id>.png` — the lobby with TEAMS on and the arena row showing
 *     all six maps, the two new ones included. The developer's actual case: a
 *     4v4 room where the sides are the sides.
 *
 * The map is chosen the way a player chooses it — `localStorage`
 * (`planet-rush:mapId`), the same seam the PLAY screen writes — set before boot.
 *
 * Every run verifies it is looking at THIS build: `/version.json` is compared to
 * the working tree's HEAD sha, because a preview server on a shared port will
 * happily serve another lane's stale bundle and go green doing it.
 *
 * Run:  node evidence/a0-12-team-maps/capture-frames.mjs
 *       EVIDENCE_BASE_URL=http://localhost:4231 node evidence/a0-12-team-maps/capture-frames.mjs
 */
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.EVIDENCE_BASE_URL ?? 'http://localhost:4231';
const VP = { width: 1440, height: 900 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const MAPS = [
  { id: 'crescents', name: 'The Crescents', sky: 'ironVeil' },
  { id: 'line', name: 'The Line', sky: 'deepEmber' },
];

mkdirSync(HERE, { recursive: true });

const head = execSync('git rev-parse HEAD', { cwd: join(HERE, '..', '..') }).toString().trim();
const notes = [];
const say = (s) => {
  notes.push(s);
  console.log(s);
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: VP, deviceScaleFactor: 2 });
const page = await ctx.newPage();
page.on('console', (m) => {
  if (m.type() === 'error') console.log('  [page error]', m.text());
});

// --- the build actually being served ---------------------------------------
const version = await (await ctx.request.get(`${BASE}/version.json`)).json().catch(() => null);
say(`working tree HEAD : ${head}`);
say(`served /version.json: ${JSON.stringify(version)}`);
if (version?.sha && !head.startsWith(version.sha) && !version.sha.startsWith(head.slice(0, 7))) {
  say('!! WARNING: the served bundle is NOT this working tree. Frames below are suspect.');
}
say('');

async function boot(mapId, query) {
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.evaluate((id) => {
    localStorage.setItem('planet-rush:mapId', id);
    localStorage.setItem('planet-rush:matchMode', 'teams');
  }, mapId);
  await page.goto(`${BASE}/${query}`, { waitUntil: 'load' });
  await sleep(4500);
}

// --- 1. a live 4v4 on each map, on its own sky ------------------------------
for (const m of MAPS) {
  await boot(m.id, '?debug=1&sides=2');
  await sleep(2500);

  // The ?debug=1 handle is read-only and does NOT publish the world, so the
  // readback is what it does publish: the build, the sim's own clock, and the
  // local ship's WORLD position. That last one is the load-bearing one here —
  // it names the arena (line is 3200x2000, crescents 2400x2400) and which half
  // of it the local player spawned on, which is the claim being photographed.
  const read = await page.evaluate(() => {
    const pr = window.__planetRush;
    return {
      build: pr?.build,
      ticks: pr?.ticks,
      fps: Math.round(pr?.fps ?? 0),
      shipWorld: pr?.shipWorld,
      minimap: window.__minimapStage?.state?.(),
    };
  });
  const sw = read.shipWorld;
  const arena = m.id === 'line' ? { w: 3200, h: 2000 } : { w: 2400, h: 2400 };
  const half = sw ? (sw.x < arena.w / 2 ? 'A (near)' : 'B (far)') : '?';

  say(`${m.name} (${m.id}) — live 4v4 at gameplay zoom, ?debug=1&sides=2`);
  say(`  build      ${JSON.stringify(read.build)}   ticks ${read.ticks}  fps ${read.fps}`);
  say(`  shipWorld  (${sw?.x?.toFixed(1)}, ${sw?.y?.toFixed(1)})  in a ${arena.w}x${arena.h} arena -> side ${half}`);
  say(`  sky        ${m.sky}  (MAP_NEBULA.${m.id}; the registry pins it, backdrop.test.ts asserts it,`);
  say(`             and the frame shows it — Iron Veil's flat sheets / Deep Ember's rim coals)`);
  await page.screenshot({ path: join(HERE, `${m.id}-match.png`) });
  say(`  wrote ${m.id}-match.png`);
  say('');
}

// --- 2. the lobby, TEAMS, six arena cards -----------------------------------
for (const m of MAPS) {
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.evaluate((id) => {
    localStorage.setItem('planet-rush:mapId', id);
    localStorage.setItem('planet-rush:matchMode', 'teams');
  }, m.id);
  await page.goto(`${BASE}/`, { waitUntil: 'load' });
  await sleep(3000);
  // The canvas is the UI, so these are real pointer events at the plates'
  // centres — the same taps a thumb sends. PLAY, then SOLO CONTRACT (offline,
  // bots hold the other seats), which lands in the lobby. It opens on TEAMS
  // because that is what the storage seam says.
  await page.mouse.click(VP.width / 2, VP.height * 0.4); // PLAY
  await sleep(2200);
  await page.mouse.click(VP.width / 2, VP.height * 0.488); // SOLO CONTRACT
  await sleep(2800);
  await page.screenshot({ path: join(HERE, `lobby-4v4-${m.id}.png`) });
  say(`wrote lobby-4v4-${m.id}.png  (map ${m.id} preselected via planet-rush:mapId, mode TEAMS)`);
}

writeFileSync(join(HERE, 'frames.txt'), notes.join('\n') + '\n');
await browser.close();
console.log(`\nwrote ${HERE}/{*-match.png,lobby-4v4-*.png,frames.txt}`);
