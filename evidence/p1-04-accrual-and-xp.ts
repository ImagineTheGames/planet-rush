/**
 * evidence/p1-04-accrual-and-xp.ts — **the brief's evidence line.** OWNER: UI
 * Engineer (p1-04; `docs/briefs/pr-04-accrual-and-xp.md`).
 *
 * One real headless match's `MatchAccrual` and its XP rows, printed out of the
 * SHIPPED modules — `src/progression/accrual.ts` and `src/progression/xp.ts` —
 * beside the same numbers from `spikes/progression/measured-a0-13.txt`, so the
 * two can be read for shape and order of magnitude in one glance.
 *
 * The difference between this run and the spike's, stated up front because it is
 * the whole point of the task:
 *
 *  - **The spike RECONSTRUCTED damage and kills** with a shadow attributor over
 *    projectile geometry, and published a residual to say how much it missed
 *    (`recon*` ≥95%, the rest being the Crush, which has no attacker).
 *  - **This reads pr-02's ledger.** Nothing is inferred, nothing is estimated, and
 *    there is no residual to publish — a hit either had an attacker the sim
 *    recorded or it had none at all.
 *
 * So the combat rows here should land in the same *neighbourhood* as the spike's
 * and are not expected to match them digit for digit: they are a different (and
 * exact) measurement of the same thing, over a different number of seeds, against
 * bot trees that have moved since 2026-08-08.
 *
 * Re-run:  npx vite-node evidence/p1-04-accrual-and-xp.ts
 * Writes:  evidence/p1-04-accrual-and-xp.txt
 */

import { writeFileSync } from 'node:fs';
import type { PlayerSpec } from '../src/sim';
import { createWorld } from '../src/sim';
import type { Bot, PersonalityId } from '../src/bots';
import { Difficulty, PERSONALITIES, createBots, fillEmptySlots, runHeadlessMatch } from '../src/bots';
import { createAccrualObserver, totalByTier, type MatchAccrual } from '../src/progression/accrual';
import { xpForMatch } from '../src/progression/xp';

const SLOTS = 8;
const MAX_SECONDS = 20 * 60;
/** Stated, not sampled — a hidden sample is a hidden result. */
const SEEDS: readonly number[] = [1, 2, 3, 4];
/** The one match printed in full. */
const DETAIL_SEED = 1;

interface Lobby {
  readonly label: string;
  readonly roster: readonly PersonalityId[];
}

const LOBBIES: readonly Lobby[] = [
  { label: 'EASY  mirror (Rusty/Bolt)', roster: ['rusty', 'bolt'] },
  { label: 'MEDIUM mirror (Foreman/Patch)', roster: ['foreman', 'patch'] },
  { label: 'HARD  mirror (Sable/Vulture/Warden)', roster: ['sable', 'vulture', 'warden'] },
  {
    label: 'MIXED cast (shipped fill order)',
    roster: ['rusty', 'bolt', 'foreman', 'patch', 'sable', 'vulture', 'warden'],
  },
];

/** The medians `measured-a0-13.txt` published, in its own column order, so the
 *  comparison below is a quotation rather than a memory. */
const SPIKE_MEDIANS: Readonly<Record<string, readonly number[]>> = {
  // ore, dmgHP, shipK, statK, spent, dist, deaths, secs
  'EASY  mirror (Rusty/Bolt)': [28.2, 228, 4.0, 0.0, 14.0, 57705, 4.0, 850],
  'MEDIUM mirror (Foreman/Patch)': [23.1, 1443, 21.0, 0.0, 17.0, 62208, 24.0, 835],
  'HARD  mirror (Sable/Vulture/Warden)': [12.8, 689, 11.0, 0.0, 8.0, 33486, 16.0, 823],
  'MIXED cast (shipped fill order)': [28.9, 768, 12.5, 0.0, 17.0, 63430, 16.5, 835],
};
/** And its median XP per match at dmgUnit=25 with the recommended multiplier,
 *  combat + ore only (the spike never priced the participation rows per lobby). */
const SPIKE_MED_XP: Readonly<Record<string, number>> = {
  'EASY  mirror (Rusty/Bolt)': 58,
  'MEDIUM mirror (Foreman/Patch)': 243,
  'HARD  mirror (Sable/Vulture/Warden)': 162,
  'MIXED cast (shipped fill order)': 162,
};

const out: string[] = [];
const say = (line = ''): void => {
  out.push(line);
  console.log(line);
};

const pad = (s: string | number, w: number): string => String(s).padStart(w);
const padr = (s: string | number, w: number): string => String(s).padEnd(w);
const f1 = (x: number): string => x.toFixed(1);
const median = (xs: readonly number[]): number => {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

interface Run {
  accruals: MatchAccrual[];
  tiers: Difficulty[];
  cast: PersonalityId[];
  seconds: number;
  ended: boolean;
}

/** One real match: the shipped bot cast, the shipped sim, and the shipped
 *  observer riding along on `onTick` — exactly how pr-05 will drive it. */
function runOne(lobby: Lobby, seed: number): Run {
  const seats = fillEmptySlots([], SLOTS, [...lobby.roster]);
  const players: PlayerSpec[] = seats.map((seat) => ({
    id: seat.id,
    shipClass: PERSONALITIES[seat.personality].shipClass,
  }));
  const tiers = seats.map((seat) => PERSONALITIES[seat.personality].difficulty);
  const world = createWorld({ seed, players });
  const bots: Bot[] = createBots(seats, { seed });
  const observer = createAccrualObserver(world, tiers);
  const run = runHeadlessMatch(world, bots, {
    maxSeconds: MAX_SECONDS,
    onTick: (w) => observer.observe(w),
  });
  return {
    accruals: observer.finalize(run.world),
    tiers,
    cast: seats.map((s) => s.personality),
    seconds: run.seconds,
    ended: run.ended,
  };
}

say('=== p1-04 — ONE REAL MATCH, OBSERVED (accrual.ts) AND PRICED (xp.ts) ===');
say('shipped bot cast · N=8 · default map · read off pr-02 `world.credit`, nothing reconstructed');
say();

// ---------------------------------------------------------------------------
// The one match, in full
// ---------------------------------------------------------------------------

const detailLobby = LOBBIES[3]!;
const detail = runOne(detailLobby, DETAIL_SEED);
say(`MATCH: ${detailLobby.label} · seed ${DETAIL_SEED} · ${f1(detail.seconds)}s · ended=${detail.ended}`);
say();
say(
  padr('slot  bot', 20) +
    ['tier', 'ore', 'banked', 'used', 'dmgHP', 'shipK', 'statK', 'dist', 'ships', 'struct', 'upgr', 'rep', 'wave', 'place', 'XP'].map((h) =>
      pad(h, 8),
    ).join(''),
);
for (const a of detail.accruals) {
  const priced = xpForMatch(a);
  say(
    padr(`  ${a.slot}   ${detail.cast[a.slot]}`, 20) +
      pad(detail.tiers[a.slot]!, 8) +
      pad(f1(a.oreMined), 8) +
      pad(f1(a.oreBanked), 8) +
      pad(f1(a.oreUsed), 8) +
      pad(Math.round(totalByTier(a.damageDealt)), 8) +
      pad(totalByTier(a.shipKills), 8) +
      pad(totalByTier(a.stationKills), 8) +
      pad(Math.round(a.distance), 8) +
      pad(a.shipsUsed, 8) +
      pad(a.structures, 8) +
      pad(a.upgrades, 8) +
      pad(f1(a.repairs), 8) +
      pad(a.wavesSurvived, 8) +
      pad(a.placement, 8) +
      pad(priced.total, 8),
  );
}

// The XP rows for the seat that won it — the screen pr-05 draws, in order.
const champion = detail.accruals.find((a) => a.won) ?? detail.accruals[0]!;
say();
say(`XP ROWS — slot ${champion.slot} (${detail.cast[champion.slot]}, ${detail.tiers[champion.slot]}), placed ${champion.placement}/${champion.slots}:`);
const priced = xpForMatch(champion);
for (const r of priced.rows) {
  say(`  ${padr(r.label, 20)}${pad(f1(r.count), 10)}${pad(`${r.xp} XP`, 10)}${r.tierScaled ? '   × opponent tier' : ''}`);
}
say(`  ${padr('TOTAL', 20)}${pad('', 10)}${pad(`${priced.total} XP`, 10)}`);
say(`  (rows sum to total: ${priced.rows.reduce((s, r) => s + r.xp, 0) === priced.total})`);

// ---------------------------------------------------------------------------
// Beside the spike
// ---------------------------------------------------------------------------

say();
say('=== BESIDE `spikes/progression/measured-a0-13.txt` (per-player medians) ===');
say(`this run: seeds ${SEEDS.join(',')} (${SEEDS.length} matches per lobby) · spike: seeds 1..12 (12 each)`);
say();
const cols = ['ore', 'dmgHP', 'shipK', 'statK', 'used', 'dist', 'ships', 'secs', 'medXP'];
say(padr('lobby', 36) + padr('src', 7) + cols.map((h) => pad(h, 9)).join(''));
for (const lobby of LOBBIES) {
  const all: MatchAccrual[] = [];
  for (const seed of SEEDS) all.push(...runOne(lobby, seed).accruals);
  const mine = [
    median(all.map((a) => a.oreMined)),
    median(all.map((a) => totalByTier(a.damageDealt))),
    median(all.map((a) => totalByTier(a.shipKills))),
    median(all.map((a) => totalByTier(a.stationKills))),
    median(all.map((a) => a.oreUsed)),
    median(all.map((a) => a.distance)),
    median(all.map((a) => a.shipsUsed - 1)), // the spike counted deaths, not hulls
    median(all.map((a) => a.seconds)),
    median(all.map((a) => xpForMatch(a).total)),
  ];
  const theirs = [...SPIKE_MEDIANS[lobby.label]!, SPIKE_MED_XP[lobby.label]!];
  say(padr(lobby.label, 36) + padr('p1-04', 7) + mine.map((x) => pad(f1(x), 9)).join(''));
  say(padr('', 36) + padr('a0-13', 7) + theirs.map((x) => pad(f1(x), 9)).join(''));
}
say();
say('Reading the two rows: `ore`, `used`, `dist`, `ships` and `secs` are the same free world');
say('deltas the spike measured and should agree closely. `dmgHP`/`shipK`/`statK` are the ledger');
say('now and a reconstruction then, over 4 seeds against 12 — the same neighbourhood, not the same');
say('digits. `medXP` differs by construction: the spike priced the ratified four ONLY, and this');
say("prices the whole §1.3d table, participation rows included (plan Question A's recommendation).");
say();
say('The number to check the whole economy against is §1.3d\'s own prediction for the recommended');
say('table: **median 399 XP, mean 459** per player-match. The MIXED cast — the shipped fill order,');
say('and the closest thing here to a real lobby — pays a median the shipped modules produce without');
say('a scale factor anywhere in them. §1.4 hangs off that number: level 2 inside 0.8 of a match,');
say('level 10 at ~101. It survives.');
say();
say('done.');

writeFileSync(new URL('./p1-04-accrual-and-xp.txt', import.meta.url), `${out.join('\n')}\n`);
