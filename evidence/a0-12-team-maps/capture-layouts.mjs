/**
 * evidence/a0-12-team-maps/capture-layouts.mjs — a0-12 "two maps with four
 * stations a side and open ground between them". OWNER: Gameplay Engineer.
 *
 * The developer: *"we can make some new maps that are more balanced for teams
 * with 4 on one side and 4 on the other."*
 *
 * This half of the evidence needs no browser, and deliberately so: a map is
 * geometry, the sim is pure, and the claim is EXACT equality — so the honest
 * artifact is the board built by the real registry and the residuals printed to
 * the digit, not a screenshot of them. It emits, per map:
 *
 *   • `<id>-layout.svg` — the board at N=8 with the two sides TINTED, every
 *     stamped body drawn (stations, ship spawns, home neighbourhoods, the full
 *     commons schedule), the dividing axis, and the wall margin.
 *   • `<id>-n4.svg` — the same at a 4v4 roster with real team assignment, which
 *     is the developer's case: each team wholly on its own side.
 *   • rows in `mirror.txt` / `mirror.json` — the mirror assertion as NUMBERS:
 *     the residual of the point reflection that swaps the sides, over every
 *     station, ship and rock; the per-side ore totals; the commons split by the
 *     dividing axis; and the launch-pocket clearance.
 *
 * Run:  node evidence/a0-12-team-maps/capture-layouts.mjs
 * (Imports the sim through vite-node so the `@shared` alias resolves.)
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createWorld,
  spawnWave,
  getMap,
  TEAM_MAP_IDS,
  SPAWN_CLEAR_POCKET,
  WAVE_COUNT,
  WORLD_EDGE_MARGIN,
} from '../../src/sim/index.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = HERE;
mkdirSync(OUT, { recursive: true });

// --- palette (style-guide roles, muted for a diagram) -----------------------
const INK = '#0b0e12';
const WALL = '#2b323c';
const AXIS = '#4b5563';
const SIDE_A = '#4DC3FF'; // plasma — side A
const SIDE_B = '#F2B233'; // signal — side B
const WRECK = '#5b636e';
const ROCK_HOME = '#6f7783';
const ROCK_COMMONS = '#8b9350';
const TEXT = '#c9d1d9';

const players = (n, team) =>
  Array.from({ length: n }, (_, i) => ({
    id: i,
    shipClass: 'interceptor',
    ...(team ? { team: i % 2 } : {}),
  }));

function fullField(mapId, n, team) {
  const w = createWorld({ seed: 1, players: players(n, team), mapId });
  while (w.match.wavesSpawned < WAVE_COUNT) spawnWave(w);
  return w;
}

const sideOf = (w, p) => (p.x < w.bounds.width / 2 ? 0 : 1);
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

// --- the diagram ------------------------------------------------------------

function svg(w, title, subtitle) {
  const { width: W, height: H } = w.bounds;
  const cx = W / 2;
  const PAD = 40;
  const LEGEND = 96;
  const parts = [];
  const p = (s) => parts.push(s);

  p(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-PAD} ${-PAD} ${W + PAD * 2} ${H + PAD * 2 + LEGEND}" width="${(W + PAD * 2) / 2}" font-family="ui-monospace,Menlo,monospace">`);
  p(`<rect x="${-PAD}" y="${-PAD}" width="${W + PAD * 2}" height="${H + PAD * 2 + LEGEND}" fill="${INK}"/>`);

  // Side tints — the whole point of the picture.
  p(`<rect x="0" y="0" width="${cx}" height="${H}" fill="${SIDE_A}" opacity="0.055"/>`);
  p(`<rect x="${cx}" y="0" width="${cx}" height="${H}" fill="${SIDE_B}" opacity="0.055"/>`);

  // Arena wall + the spawn margin every body clears.
  p(`<rect x="0" y="0" width="${W}" height="${H}" fill="none" stroke="${WALL}" stroke-width="4"/>`);
  p(
    `<rect x="${WORLD_EDGE_MARGIN}" y="${WORLD_EDGE_MARGIN}" width="${W - 2 * WORLD_EDGE_MARGIN}" height="${H - 2 * WORLD_EDGE_MARGIN}" fill="none" stroke="${WALL}" stroke-width="2" stroke-dasharray="14 12"/>`,
  );
  // The dividing axis — contested ground is what is either side of it.
  p(`<line x1="${cx}" y1="0" x2="${cx}" y2="${H}" stroke="${AXIS}" stroke-width="3" stroke-dasharray="20 14"/>`);

  // The commons scatter disc.
  p(`<circle cx="${cx}" cy="${H / 2}" r="${w.fieldRadius}" fill="none" stroke="${ROCK_COMMONS}" stroke-width="2" opacity="0.5"/>`);

  // Rocks.
  for (const a of w.asteroids) {
    const home = a.home != null;
    p(
      `<circle cx="${a.pos.x.toFixed(1)}" cy="${a.pos.y.toFixed(1)}" r="${a.radius.toFixed(1)}" fill="${home ? ROCK_HOME : ROCK_COMMONS}" opacity="${home ? 0.85 : 0.6}"/>`,
    );
  }
  // Loose debris around wrecks.
  for (const c of w.chunks) {
    p(`<circle cx="${c.pos.x.toFixed(1)}" cy="${c.pos.y.toFixed(1)}" r="${(c.radius ?? 8).toFixed(1)}" fill="${WRECK}" opacity="0.7"/>`);
  }

  // Launch pockets — the invariant that had to join the fairness rules once.
  const live = w.stations.filter((s) => !s.derelict);
  const ringR = Math.min(...live.map((s) => dist(s.pos, { x: cx, y: H / 2 })));
  const pocket = ringR * SPAWN_CLEAR_POCKET;
  for (const s of w.stations) {
    p(
      `<circle cx="${s.pos.x.toFixed(1)}" cy="${s.pos.y.toFixed(1)}" r="${pocket.toFixed(1)}" fill="none" stroke="${AXIS}" stroke-width="1.5" stroke-dasharray="6 10" opacity="0.55"/>`,
    );
  }

  // Ship spawns.
  for (const s of w.ships) {
    const tint = sideOf(w, s.pos) === 0 ? SIDE_A : SIDE_B;
    p(`<circle cx="${s.pos.x.toFixed(1)}" cy="${s.pos.y.toFixed(1)}" r="16" fill="${tint}" opacity="0.9"/>`);
  }

  // Stations, labelled with board position and owner.
  for (const s of w.stations) {
    const tint = s.derelict ? WRECK : sideOf(w, s.pos) === 0 ? SIDE_A : SIDE_B;
    p(
      `<circle cx="${s.pos.x.toFixed(1)}" cy="${s.pos.y.toFixed(1)}" r="${s.radius}" fill="${tint}" opacity="${s.derelict ? 0.45 : 1}" stroke="${INK}" stroke-width="3"/>`,
    );
    const label = s.derelict ? 'wreck' : `P${s.owner}`;
    p(
      `<text x="${s.pos.x.toFixed(1)}" y="${(s.pos.y + 9).toFixed(1)}" fill="${INK}" font-size="34" font-weight="700" text-anchor="middle">${label}</text>`,
    );
  }

  // Legend.
  const ly = H + 34;
  p(`<text x="0" y="${ly}" fill="${TEXT}" font-size="40" font-weight="700">${title}</text>`);
  p(`<text x="0" y="${ly + 44}" fill="${TEXT}" font-size="28" opacity="0.8">${subtitle}</text>`);
  p(
    `<text x="0" y="${ly + 84}" fill="${TEXT}" font-size="26" opacity="0.65">` +
      `<tspan fill="${SIDE_A}">■</tspan> side A   <tspan fill="${SIDE_B}">■</tspan> side B   ` +
      `<tspan fill="${WRECK}">■</tspan> derelict wreck   ` +
      `<tspan fill="${ROCK_HOME}">●</tspan> home field   <tspan fill="${ROCK_COMMONS}">●</tspan> commons   ` +
      `dashed ring = SPAWN_CLEAR_POCKET (${pocket.toFixed(1)} u)   dashed box = WORLD_EDGE_MARGIN` +
      `</text>`,
  );
  p('</svg>');
  return parts.join('\n');
}

// --- the numbers ------------------------------------------------------------

/** Point reflection through the arena centre — the isometry that swaps sides. */
const through = (w, p) => ({ x: w.bounds.width - p.x, y: w.bounds.height - p.y });
const nearest = (p, pts) => pts.reduce((b, q) => Math.min(b, dist(p, q)), Infinity);

function measure(mapId) {
  const w = fullField(mapId, 8, false);
  const cx = w.bounds.width / 2;

  const stations = w.stations.map((s) => s.pos);
  const ships = w.ships.map((s) => s.pos);
  let rStation = 0;
  let rShip = 0;
  let rRock = 0;
  for (const p of stations) rStation = Math.max(rStation, nearest(through(w, p), stations));
  for (const p of ships) rShip = Math.max(rShip, nearest(through(w, p), ships));
  for (const a of w.asteroids) {
    const sameOre = w.asteroids.filter((b) => b.ore === a.ore).map((b) => b.pos);
    rRock = Math.max(rRock, nearest(through(w, a.pos), sameOre));
  }

  // Midline mirror (station centres) — the mirror a player sees.
  const acrossAxis = (p) => ({ x: w.bounds.width - p.x, y: p.y });
  let rMirror = 0;
  for (const p of stations) rMirror = Math.max(rMirror, nearest(acrossAxis(p), stations));

  // Per-side ore, per-home ore, commons split.
  const sideOre = [0, 0];
  const homeOre = [];
  for (const s of w.stations.filter((x) => !x.derelict)) {
    const ore = w.asteroids.filter((a) => a.home === s.owner).reduce((t, a) => t + a.ore, 0);
    homeOre.push(ore);
    sideOre[sideOf(w, s.pos)] += ore;
  }
  const commons = [0, 0];
  for (const a of w.asteroids) if (a.home == null) commons[a.pos.x < cx ? 0 : 1] += a.ore;

  // Distance-to-the-middle profile per side.
  const c = { x: cx, y: w.bounds.height / 2 };
  const runs = [[], []];
  for (const s of w.stations.filter((x) => !x.derelict)) runs[sideOf(w, s.pos)].push(dist(s.pos, c));
  runs.forEach((r) => r.sort((a, b) => a - b));

  // Launch pocket, cross-station, worst over the seed grid.
  let pocketSlack = Infinity;
  let turretSlack = Infinity;
  for (const seed of [1, 2, 3, 7, 42, 1337, 99991, 20260725, 0x7fffffff]) {
    for (const n of [2, 3, 4, 5, 6, 7, 8]) {
      const f = createWorld({ seed, players: players(n, false), mapId });
      while (f.match.wavesSpawned < WAVE_COUNT) spawnWave(f);
      const fc = { x: f.bounds.width / 2, y: f.bounds.height / 2 };
      const ring = Math.min(...f.stations.filter((s) => !s.derelict).map((s) => dist(s.pos, fc)));
      const pk = ring * SPAWN_CLEAR_POCKET;
      for (const s of f.stations) {
        for (const a of f.asteroids) {
          pocketSlack = Math.min(pocketSlack, dist(a.pos, s.pos) - a.radius - pk);
          if (a.home === s.owner) turretSlack = Math.min(turretSlack, dist(a.pos, s.pos) - 240);
        }
      }
    }
  }

  // Nearest ally / nearest enemy, on a real 4v4.
  const t = createWorld({ seed: 1, players: players(8, true), mapId });
  const tl = t.stations.filter((s) => !s.derelict);
  let ally = Infinity;
  let enemy = Infinity;
  let corridor = Infinity;
  for (const a of tl) {
    corridor = Math.min(corridor, Math.abs(a.pos.x - cx));
    for (const b of tl) {
      if (a === b) continue;
      const d = dist(a.pos, b.pos);
      if (sideOf(t, a.pos) === sideOf(t, b.pos)) ally = Math.min(ally, d);
      else enemy = Math.min(enemy, d);
    }
  }
  const seating = tl.map((s) => ({
    owner: s.owner,
    team: t.ships[s.owner].team,
    side: sideOf(t, s.pos) === 0 ? 'A' : 'B',
  }));

  return {
    id: mapId,
    name: getMap(mapId).name,
    bounds: w.bounds,
    reflectionResidual: { stations: rStation, ships: rShip, asteroids: rRock, count: w.asteroids.length },
    midlineMirrorResidualStations: rMirror,
    homeOre,
    sideOre,
    sideOreExactlyEqual: sideOre[0] === sideOre[1],
    commons,
    commonsDelta: Math.abs(commons[0] - commons[1]),
    runsToMiddle: runs,
    pocketSlack,
    turretSlack,
    nearestAlly: ally,
    nearestEnemy: enemy,
    emptyCorridor: 2 * corridor,
    seating,
  };
}

// --- emit -------------------------------------------------------------------

const lines = [];
const json = [];
const say = (s = '') => {
  lines.push(s);
  console.log(s);
};

say('a0-12 — two maps with four stations a side. THE MIRROR, AS NUMBERS.');
say('='.repeat(78));
say('');
say('The two sides are related by a POINT REFLECTION through the arena centre.');
say('That isometry is chosen because `spawnHomeFields` stamps every home');
say('neighbourhood by a ROTATION, so rotating the board by pi carries stations,');
say('ships, home fields and the N-fold-symmetric commons onto themselves — side');
say('equality is the same fact as "the stamp is a rotation", not a tuning result.');
say('');

for (const id of TEAM_MAP_IDS) {
  const m = measure(id);
  json.push(m);
  const map = getMap(id);

  writeFileSync(
    join(OUT, `${id}-layout.svg`),
    svg(
      fullField(id, 8, false),
      `${map.name}  (${id})  —  N=8, full field`,
      map.blurb,
    ),
  );
  writeFileSync(
    join(OUT, `${id}-n4.svg`),
    svg(
      fullField(id, 4, true),
      `${map.name}  (${id})  —  a real 2v2: team 0 side A, team 1 side B`,
      'the 8-N unused board positions are unowned derelict wrecks, still mirror-paired',
    ),
  );

  say(`${map.name}  (${id})   arena ${m.bounds.width}x${m.bounds.height}`);
  say('-'.repeat(78));
  say(`  point-reflection residual, N=8 full field (${m.reflectionResidual.count} rocks):`);
  say(`      stations   ${m.reflectionResidual.stations.toExponential(3)} u`);
  say(`      ships      ${m.reflectionResidual.ships.toExponential(3)} u`);
  say(`      asteroids  ${m.reflectionResidual.asteroids.toExponential(3)} u   (position AND ore matched)`);
  say(`  midline-mirror residual, station centres: ${m.midlineMirrorResidualStations.toExponential(3)} u`);
  say('');
  say(`  per-home ore   ${m.homeOre.map((o) => o.toFixed(9)).join('  ')}`);
  say(`  per-side ore   A ${m.sideOre[0].toFixed(9)}   B ${m.sideOre[1].toFixed(9)}   exactly equal: ${m.sideOreExactlyEqual}`);
  say(`  commons split  A ${m.commons[0].toFixed(9)}   B ${m.commons[1].toFixed(9)}   delta ${m.commonsDelta.toExponential(3)}`);
  say('');
  say(`  run to the middle, side A  ${m.runsToMiddle[0].map((d) => d.toFixed(3)).join('  ')}`);
  say(`  run to the middle, side B  ${m.runsToMiddle[1].map((d) => d.toFixed(3)).join('  ')}`);
  say('');
  say(`  SPAWN_CLEAR_POCKET slack (cross-station, worst of 9 seeds x N=2..8):  +${m.pocketSlack.toFixed(1)} u`);
  say(`  own-turret-range slack   (worst of the same grid):                    +${m.turretSlack.toFixed(1)} u`);
  say(`  nearest ally ${m.nearestAlly.toFixed(0)} u | nearest enemy ${m.nearestEnemy.toFixed(0)} u  (${(m.nearestEnemy / m.nearestAlly).toFixed(2)}x) | empty corridor ${m.emptyCorridor.toFixed(0)} u`);
  say('');
  say('  4v4 seating (lobby teams alternate by slot, defaultTeamForSlot = index % 2):');
  for (const s of m.seating) say(`      P${s.owner}  team ${s.team}  ->  side ${s.side}`);
  say('');
  say('');
}

say('Every number above is produced by the shipped registry through `createWorld`,');
say('the same call a booted match makes. Regenerate with:');
say('  npx vite-node evidence/a0-12-team-maps/capture-layouts.mjs');

writeFileSync(join(OUT, 'mirror.txt'), lines.join('\n') + '\n');
writeFileSync(join(OUT, 'mirror.json'), JSON.stringify(json, null, 2) + '\n');
console.log(`\nwrote ${OUT}/{mirror.txt,mirror.json,*-layout.svg,*-n4.svg}`);
