/**
 * evidence/a0-120-world-size/render.ts — the three-column tables in
 * `tests/reports/a0-120-world-size.md`. OWNER: Bot Engineer (brief a0-120).
 *
 * a0-117's `harness/tuning.ts` renders a **pair** of columns — one tree before a
 * constant moved, one after. a0-120 has to print **three**, because the question
 * is not "what did the dial do" but "is there any setting of it that satisfies
 * two constraints at once", and that needs the shipped arena beside both
 * candidate ceilings in one row.
 *
 * So this file computes nothing of its own either: every rate, fair share and
 * standard error comes from `harness/mirrors`' helpers, exactly as a0-112's and
 * a0-117's tables do, and **the seed assertion is a0-117's own**
 * (`harness/tuning.ts` `assertSameSeeds`), applied to each candidate against the
 * before column in turn. A column that is not the same draw is a failed
 * measurement and throws here rather than being printed.
 *
 *   npx vite-node evidence/a0-120-world-size/render.ts
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ShipClass } from '@shared/types';
import { createWorld } from '../../src/sim';
import { MAPS } from '../../src/sim/maps';
import { SHIP_SENSOR_RANGE, STATION_SENSOR_RANGE, WORLD_SIZE } from '../../src/sim/constants';
import { pointSensed, sensorSources } from '../../src/sim/sensing';
import { DEFAULT_PERCEPTION, HUMAN_VISUAL_RANGE, perceive } from '../../src/bots/perception';
import {
  classSeats,
  lengthOf,
  mmss,
  ownHullOf,
  pct,
  seatsByCharacter,
  seatsByOwnHull,
  seatsByTier,
  winSE,
  winsBy,
} from '../../harness/mirrors';
import type { MatchRow, SectionRun, Win } from '../../harness/mirrors';
import { assertSameSeeds } from '../../harness/tuning';

const ROOT = resolve(import.meta.dirname, '../..');
const read = (p: string): SectionRun => JSON.parse(readFileSync(resolve(ROOT, p), 'utf8')) as SectionRun;

/** The three arenas, in the order the report reads them. */
const COLUMNS = [
  { label: 'shipped 2400', dir: 'tests/reports/a0-117-data/before' },
  { label: '**2807**', dir: 'tests/reports/a0-120-data/w2807' },
  { label: '3199', dir: 'tests/reports/a0-120-data/w3199' },
] as const;

function table(head: readonly string[], rows: readonly (readonly string[])[]): string {
  return [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rows.map((r) => `| ${r.join(' | ')} |`)].join('\n');
}

const CUTS = {
  class: { key: (r: MatchRow) => (r.winnerClass === null ? null : String(r.winnerClass)), seats: classSeats },
  hull: { key: ownHullOf, seats: seatsByOwnHull },
  character: { key: (r: MatchRow) => r.winner, seats: seatsByCharacter },
  tier: { key: (r: MatchRow) => (r.winnerTier === null ? null : String(r.winnerTier)), seats: seatsByTier },
} as const;

/** One contest, all three arenas side by side, rows ordered by the SHIPPED rate
 *  so the contestant the brief is about stays at the top whatever the dial did. */
function compare(section: string, cut: keyof typeof CUTS): string {
  const runs = COLUMNS.map((c) => read(`${c.dir}/${section}.json`));
  const before = runs[0]!;
  for (const after of runs.slice(1)) assertSameSeeds({ before, after });
  const { key, seats } = CUTS[cut];
  const cols = runs.map((r) => winsBy(r.matches, key, seats));
  const cell = (w: Win | undefined): string =>
    w === undefined || w.decided === 0 ? '**no decided match**' : `${w.wins} / ${w.decided} (**${pct(w.rate)}**)`;
  return table(
    ['contestant', ...COLUMNS.map((c) => c.label), 'fair share', '±1 SE (2807)', '2807 vs 55%'],
    cols[0]!.map((b) => {
      const at = cols.map((c) => c.find((w) => w.key === b.key));
      const c2807 = at[1];
      return [
        b.name,
        ...at.map(cell),
        pct(b.fairShare),
        c2807 && c2807.decided ? `${(winSE(c2807.rate, c2807.decided) * 100).toFixed(1)} pts` : '—',
        c2807 && c2807.decided ? (c2807.rate > 0.55 ? '**OVER**' : 'under') : '—',
      ];
    }),
  );
}

/** Match length — the target a hull nerf can trade away (GDD §1). */
function lengths(): string {
  const rows: string[][] = [];
  for (const section of ['class', 'roster'] as const) {
    const stats = COLUMNS.map((c) => lengthOf(read(`${c.dir}/${section}.json`).matches));
    rows.push([
      section === 'class' ? 'ship-class contest' : 'shipped cast (roster contest)',
      String(stats[0]!.n),
      ...stats.map((L) => `${mmss(L.median)}`),
      ...stats.map((L) => `${(L.insideFraction * 100).toFixed(1)}%`),
    ]);
  }
  return table(
    ['run', 'decided', ...COLUMNS.map((c) => `median ${c.label}`), ...COLUMNS.map((c) => `inside 10–15 ${c.label}`)],
    rows,
  );
}

/**
 * The equal-skill pools — GDD §3.8's own target, and the only place Bolt has a
 * win rate at all. One hull, one tier's pool, rotated over all eight seats, so a
 * win is attributable to the tree and the personality and nothing else.
 *
 * The pool is the denominator here, not the board: `easy` seats two characters,
 * so its fair share is 50% and the 55% ceiling is a five-point test rather than
 * the thirty-point one it is in the four-hull contest (a0-112 §2.3's caveat,
 * which stands). And a pool that mostly DRAWS has no win rate to bring inside
 * anything — the decided count is printed for every cell for that reason.
 */
function tierPools(): string {
  const runs = COLUMNS.map((c) => read(`${c.dir}/tier.json`));
  const before = runs[0]!;
  for (const after of runs.slice(1)) assertSameSeeds({ before, after });
  const rows: string[][] = [];
  for (const tier of ['easy', 'medium', 'hard'] as const) {
    const pools = runs.map((r) =>
      winsBy(
        r.matches.filter((m) => m.lineup.startsWith(`${tier}:`)),
        (m) => m.winner,
        seatsByCharacter,
      ),
    );
    for (const b of pools[0]!) {
      const at = pools.map((p) => p.find((w) => w.key === b.key));
      rows.push([
        `${tier} · ${b.name}`,
        ...at.map((w) =>
          w === undefined || w.decided === 0 ? '**no decided match**' : `${w.wins} / ${w.decided} (**${pct(w.rate)}**)`,
        ),
        pct(b.fairShare),
        ...at.map((w) => (w === undefined || w.decided === 0 ? '—' : w.rate > 0.55 ? '**OVER**' : 'under')),
      ]);
    }
  }
  return table(
    ['pool · contestant', ...COLUMNS.map((c) => c.label), 'fair share', ...COLUMNS.map((c) => `${c.label} vs 55%`)],
    rows,
  );
}

/** What was run, so the report is reproducible from itself (a0-112 §1's form). */
function sections(): string {
  const rows: string[][] = [];
  for (const section of ['class', 'roster', 'tier'] as const) {
    const runs = COLUMNS.map((c) => read(`${c.dir}/${section}.json`));
    const b = runs[0]!;
    rows.push([
      `\`${section}\``,
      b.label,
      String(b.seeds.length),
      String(b.rotations),
      String(b.matches.length),
      runs.map((r) => String(r.matches.filter((m) => m.ok && m.winner !== null).length)).join(' → '),
      runs.map((r) => String(r.matches.filter((m) => m.ok && m.winner === null).length)).join(' → '),
      runs.map((r) => String(r.matches.filter((m) => !m.ok).length)).join(' → '),
    ]);
  }
  return table(
    ['section', 'lineup', 'seeds', 'rotations', 'matches', 'decided (2400 → 2807 → 3199)', 'draws', 'failures'],
    rows,
  );
}

// --- the ore-field check ---------------------------------------------------

const SQUARE_MAPS = MAPS.filter((m) => m.bounds.width === WORLD_SIZE && m.bounds.height === WORLD_SIZE).map((m) => m.id);
const SEEDS = Array.from({ length: 60 }, (_, i) => i + 1);

/** Berths sampled per map: one per live player, over 2–8 players × 60 seeds. */
const BERTHS_PER_MAP = SEEDS.length * [2, 3, 4, 5, 6, 7, 8].reduce((a, b) => a + b, 0);

/** Berth → its own field, both radii, over 2–8 players × 60 seeds. Returns the
 *  worst surface distance and how many berths are blind at each radius. */
function oreField(W: number, mapId: string) {
  let worst = 0;
  let blindFog = 0;
  let blindBot = 0;
  let berths = 0;
  for (let n = 2; n <= 8; n++) {
    for (const seed of SEEDS) {
      const world = createWorld({
        seed,
        players: Array.from({ length: n }, (_, id) => ({ id, shipClass: ShipClass.Vanguard })),
        mapId,
        bounds: { width: W, height: W },
      });
      for (const ship of world.ships) {
        berths++;
        const mine = world.asteroids.filter((a) => a.home === ship.id);
        const sources = sensorSources(world, ship.id);
        if (!mine.some((a) => pointSensed(sources, a.pos, a.radius))) blindFog++;
        const inView = new Set(perceive(world, ship.id).asteroids.map((a) => a.id));
        if (!mine.some((a) => inView.has(a.id))) blindBot++;
        const st = world.stations.find((p) => p.owner === ship.id)!;
        let near = Infinity;
        for (const a of mine) {
          const dStation = Math.hypot(a.pos.x - st.pos.x, a.pos.y - st.pos.y) - a.radius;
          const dShip = Math.hypot(a.pos.x - ship.pos.x, a.pos.y - ship.pos.y) - a.radius;
          near = Math.min(near, dStation <= STATION_SENSOR_RANGE ? 0 : dShip);
        }
        worst = Math.max(worst, near);
      }
    }
  }
  return { worst, blindFog, blindBot, berths };
}

function oreTable(sizes: readonly number[]): string {
  return table(
    ['`WORLD_SIZE`', ...SQUARE_MAPS.map((m) => `\`${m}\` — worst berth→field`), `blind berths (of ${BERTHS_PER_MAP} per map, ${BERTHS_PER_MAP * SQUARE_MAPS.length} in all)`, `vs SHIP_SENSOR_RANGE ${SHIP_SENSOR_RANGE}`],
    sizes.map((W) => {
      const per = SQUARE_MAPS.map((m) => oreField(W, m));
      const blind = per.reduce((s, r) => s + r.blindFog, 0);
      const worst = Math.max(...per.map((r) => r.worst));
      return [
        String(W),
        ...per.map((r) => `${r.worst.toFixed(1)}${r.blindFog ? ` (**${r.blindFog} blind**)` : ''}`),
        blind === 0 ? '0' : `**${blind}**`,
        worst <= SHIP_SENSOR_RANGE
          ? `${(SHIP_SENSOR_RANGE - worst).toFixed(1)} u of headroom`
          : `**short by ${(worst - SHIP_SENSOR_RANGE).toFixed(2)} u**`,
      ];
    }),
  );
}

/** What a structural fix costs: the smallest ship sensor radius that keeps every
 *  berth on every square map seeing its own field, per arena. */
function sensorTable(sizes: readonly number[]): string {
  return table(
    ['`WORLD_SIZE`', '`SHIP_SENSOR_RANGE` required', 'as a multiple of 520', 'proportional rule `520 × W/2400`', 'vs satellite 900'],
    sizes.map((W) => {
      const need = Math.max(...SQUARE_MAPS.map((m) => oreField(W, m).worst));
      const prop = (520 * W) / 2400;
      return [
        String(W),
        `**${Math.ceil(need)}**`,
        `×${(need / 520).toFixed(3)}`,
        `${prop.toFixed(0)}${prop >= need ? ' ✓ covers it' : ' ✗ short'}`,
        `${(900 / Math.ceil(need)).toFixed(2)}× (is ${(900 / 520).toFixed(2)}× today)`,
      ];
    }),
  );
}

// --- output ----------------------------------------------------------------
//
// The prose lives in `report.md.tmpl` beside this file and the tables are
// spliced into it by name, so the report is regenerable end to end and the
// hand-written half is one readable document rather than an array of string
// literals. Every `{{name}}` below is a table computed above; a placeholder
// with no table, or a table with no placeholder, is an error rather than a
// silently half-rendered report.

const TABLES: Record<string, string> = {
  'class-by-hull': compare('class', 'class'),
  'roster-by-hull': compare('roster', 'hull'),
  'roster-by-character': compare('roster', 'character'),
  'roster-by-tier': compare('roster', 'tier'),
  'tier-pools': tierPools(),
  'length': lengths(),
  'ore-field': oreTable([2400, 2807, 2808, 3199, 3200, 3400]),
  'sensor-rescale': sensorTable([2807, 3199, 3400]),
  'sections': sections(),
  'constants': [
    `\`SHIP_SENSOR_RANGE\` ${SHIP_SENSOR_RANGE} · \`STATION_SENSOR_RANGE\` ${STATION_SENSOR_RANGE} · `,
    `bot \`visualRange\` ${DEFAULT_PERCEPTION.visualRange} (ceiling ${HUMAN_VISUAL_RANGE}) · `,
    `berths sampled ${BERTHS_PER_MAP} per map, ${BERTHS_PER_MAP * SQUARE_MAPS.length} in all`,
  ].join(''),
};

const tmpl = readFileSync(resolve(import.meta.dirname, 'report.md.tmpl'), 'utf8');
const used = new Set<string>();
const out = tmpl.replace(/\{\{([a-z-]+)\}\}/g, (_m, name: string) => {
  const t = TABLES[name];
  if (t === undefined) throw new Error(`render: report.md.tmpl asks for a table named "${name}" and there is none`);
  used.add(name);
  return t;
});
const unused = Object.keys(TABLES).filter((k) => !used.has(k));
if (unused.length > 0) throw new Error(`render: computed but never placed: ${unused.join(', ')}`);

const path = resolve(ROOT, 'tests/reports/a0-120-world-size.md');
writeFileSync(path, out);
console.log(`wrote ${path} (${out.split('\n').length} lines, ${used.size} tables)`);
