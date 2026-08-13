/**
 * tests/codex/codex-constants.test.ts — the codex validation gate (brief c1-01).
 *
 * The codex is player-facing fiction, but its numbers are the game's real
 * tunables. This test is the anti-drift lock the brief requires: every numeric
 * claim in codex-systems.json (and codex-ships.json) that names a tunable carries
 * a `facts[]` entry with a `constant` pointer into src/sim/constants.ts, and this
 * test parses BOTH — the JSON and the live constants module — and fails the build
 * on any mismatch. A codex number can never silently fall out of sync with the
 * sim it describes.
 *
 * It also guards the v0.7 term/fact contract (docs: content/codex/pipeline/
 * critic-rules.md): the stale GDD-v0.4 repair facts (a held channel, 2 HP/s,
 * 1 ore per 5 HP) must never survive, and every file must be non-empty.
 *
 * OWNER: Gameplay Engineer (content/codex/ + src/sim/constants.ts).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as C from '../../src/sim/constants';

const CODEX_DIR = fileURLToPath(new URL('../../content/codex/', import.meta.url));

interface Fact {
  label: string;
  value: number;
  unit?: string;
  constant: string;
}
interface Entry {
  id: string;
  title: string;
  category: string;
  summary?: string;
  body: string;
  facts?: Fact[];
}
interface CodexFile {
  codex: string;
  entries: Entry[];
}

function load(name: string): CodexFile {
  const raw = readFileSync(`${CODEX_DIR}codex-${name}.json`, 'utf8');
  return JSON.parse(raw) as CodexFile;
}

/** Resolve a dotted path (e.g. "TURRET.cost", "SHIP_STATS.hauler.cargo",
 *  "REPAIR_HP_PER_ORE") against the imported constants module. Returns the
 *  resolved value, or `undefined` if any segment is missing. */
function resolveConstant(path: string): unknown {
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc == null || typeof acc !== 'object') return undefined;
    return (acc as Record<string, unknown>)[key];
  }, C as unknown);
}

// OBJECTIVE joined the codex as its first section (a0-34): one tab, one file,
// the same one-to-one contract as the other four — so it is checked here on the
// same terms (non-empty, unique ids, v0.7 terms) rather than special-cased.
const TYPES = ['objective', 'bots', 'ships', 'systems', 'strategy'] as const;
const files = Object.fromEntries(TYPES.map((t) => [t, load(t)])) as Record<
  (typeof TYPES)[number],
  CodexFile
>;

describe('codex — files exist and are non-empty', () => {
  for (const t of TYPES) {
    it(`codex-${t}.json has entries`, () => {
      expect(Array.isArray(files[t].entries)).toBe(true);
      expect(files[t].entries.length).toBeGreaterThan(0);
    });
  }

  it('entry ids are unique across the whole codex', () => {
    const ids = TYPES.flatMap((t) => files[t].entries.map((e) => e.id));
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('codex — every numeric fact matches src/sim/constants.ts', () => {
  // The brief's four named tunables MUST be claimed somewhere and be correct.
  const REQUIRED = [
    'REPAIR_HP_PER_ORE',
    'REPAIR_COOLDOWN_SECONDS',
    'CARGO_BASE',
    'CARGO_CAP_MAX',
    'DEATH_ORE_DROP_FRACTION',
  ];

  const factCarrying = (['systems', 'ships'] as const).flatMap((t) =>
    files[t].entries.flatMap((e) => (e.facts ?? []).map((f) => ({ t, id: e.id, f }))),
  );

  it('has at least one fact to check', () => {
    expect(factCarrying.length).toBeGreaterThan(0);
  });

  for (const { t, id, f } of factCarrying) {
    it(`${t}/${id}: ${f.constant} === ${f.value}`, () => {
      const actual = resolveConstant(f.constant);
      expect(
        actual,
        `codex fact "${f.label}" points at constant "${f.constant}" which does not exist`,
      ).toBeDefined();
      expect(
        actual,
        `codex claims ${f.constant} = ${f.value} but constants.ts has ${String(actual)}`,
      ).toBe(f.value);
    });
  }

  for (const name of REQUIRED) {
    it(`the tunable ${name} is claimed by the codex`, () => {
      const claimed = factCarrying.some(({ f }) => f.constant === name);
      expect(claimed, `no codex fact points at ${name}`).toBe(true);
    });
  }
});

describe('codex — v0.7 term & fact contract', () => {
  const systemsRaw = readFileSync(`${CODEX_DIR}codex-systems.json`, 'utf8');
  const allRaw = TYPES.map((t) => readFileSync(`${CODEX_DIR}codex-${t}.json`, 'utf8')).join('\n');

  it('no stale v0.4 repair facts survive in systems', () => {
    // The exact stale strings the DoD guards, plus their prose variants.
    expect(systemsRaw).not.toMatch(/2 per second/);
    expect(systemsRaw).not.toMatch(/1 ore per 5/);
    expect(systemsRaw.toLowerCase()).not.toMatch(/repair (channel|beam)/);
    expect(systemsRaw.toLowerCase()).not.toMatch(/1 ore per 5 hp/);
  });

  it('repair is described as discrete: 15 HP, 1 ore, 15s cooldown', () => {
    const repair = files.systems.entries.find((e) => e.id === 'sys-repair-reactor');
    expect(repair, 'sys-repair-reactor entry missing').toBeDefined();
    const facts = repair!.facts ?? [];
    const byConst = (n: string) => facts.find((f) => f.constant === n)?.value;
    expect(byConst('REPAIR_HP_PER_ORE')).toBe(15);
    expect(byConst('REPAIR_ORE_COST')).toBe(1);
    expect(byConst('REPAIR_COOLDOWN_SECONDS')).toBe(15);
  });

  it('combat reads as projectiles, never beams/lasers/hitscan', () => {
    expect(allRaw.toLowerCase()).not.toMatch(/\b(beam|laser|hitscan)\b/);
  });

  it('homes read as mining stations, never planets', () => {
    // "Planet Rush" is the game's title (brand) and is explicitly kept (GDD §0);
    // strip it before checking that no home is fictioned as a "planet".
    const withoutBrand = allRaw.toLowerCase().replace(/planet rush/g, '');
    expect(withoutBrand).not.toMatch(/\bplanet(s)?\b/);
  });

  it('the cut boost/ping verbs never appear as mechanics', () => {
    // Guard the specific cut features without tripping on unrelated prose.
    expect(allRaw.toLowerCase()).not.toMatch(/minimap ping|ping tap|boost button|speed boost/);
  });

  it('the seven bots are all present with a difficulty tier', () => {
    const names = ['Rusty', 'Bolt', 'Foreman', 'Patch', 'Sable', 'Vulture', 'Warden'];
    for (const n of names) {
      const e = files.bots.entries.find((x) => x.title.startsWith(n));
      expect(e, `bot ${n} missing`).toBeDefined();
    }
    const tiers = files.bots.entries
      .filter((e) => e.id !== 'bots-overview')
      .map((e) => (e as unknown as { difficulty?: string }).difficulty);
    expect(tiers.every((d) => d === 'Easy' || d === 'Medium' || d === 'Hard')).toBe(true);
  });

  it('the four hulls use their lobby names', () => {
    const raw = readFileSync(`${CODEX_DIR}codex-ships.json`, 'utf8');
    for (const pair of ['Interceptor (Quadfin)', 'Vanguard (Anvil)', 'Excavator (Pincer)', 'Hauler (Hammerhead)']) {
      expect(raw).toContain(pair);
    }
  });
});
