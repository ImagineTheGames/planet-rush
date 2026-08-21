/**
 * tests/harness/a0-126-interval.test.ts — the arithmetic a balance verdict is
 * made of, and the shard fold it is measured through. OWNER: QA Agent (a0-126).
 *
 * a0-121 reported Warden at 57.0% against a 55% ceiling and called it "2.0
 * points short". a0-126's finding is that 2.0 points on 223 matches is not a
 * number — it is four matches — and the whole brief turns on an interval. An
 * interval that is wrong is worse than no interval at all, because it launders
 * a coin toss into a verdict, so every function that produces one is pinned
 * here against a value computed some other way:
 *
 *   - Wilson against its closed form at a textbook case;
 *   - Clopper–Pearson against the *definition* it is a bisection for (the tail
 *     probability at each endpoint really is α/2);
 *   - the binomial tails against each other (they must sum through 1) and
 *     against an exactly-enumerable small case;
 *   - the design effect against two constructed extremes — clusters that agree
 *     completely, and clusters drawn independently.
 *
 * And `mergeSections` is pinned on the property the deep run rests on: shards
 * of a disjoint seed span fold to exactly what one process would have produced,
 * and a fold that could silently double-count is refused.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  binomTailGE,
  binomTailLE,
  clopper,
  designEffect,
  exactLoAbove,
  lnBinomPmf,
  normalCdf,
  sampleFor,
  sampleForExact,
  wilson,
  zFor,
} from '../../evidence/a0-126-the-last-two-points/stats';
import { mergeSections, seatsByCharacter, winsBy } from '../../harness/mirrors';
import type { MatchRow, SectionRun } from '../../harness/mirrors';
import { WIN_RATE_CEILING } from '../../harness/mirrors';

// ---------------------------------------------------------------------------
// The tails
// ---------------------------------------------------------------------------

describe('the binomial tails are exact', () => {
  it('the pmf sums to one', () => {
    for (const [n, p] of [
      [10, 0.5],
      [30, 0.13],
      [223, 0.55],
    ] as const) {
      let sum = 0;
      for (let k = 0; k <= n; k++) sum += Math.exp(lnBinomPmf(k, n, p));
      expect(sum).toBeCloseTo(1, 10);
    }
  });

  it('agrees with a hand enumeration of four coin flips', () => {
    // P(>= 3 heads of 4) = (4 + 1)/16.
    expect(binomTailGE(3, 4, 0.5)).toBeCloseTo(5 / 16, 12);
    expect(binomTailLE(1, 4, 0.5)).toBeCloseTo(5 / 16, 12);
  });

  it('the two tails partition the mass', () => {
    for (let k = 0; k <= 40; k++) {
      expect(binomTailLE(k, 40, 0.37) + binomTailGE(k + 1, 40, 0.37)).toBeCloseTo(1, 10);
    }
  });

  it('the degenerate ends do not throw', () => {
    expect(binomTailGE(0, 10, 0.3)).toBe(1);
    expect(binomTailGE(11, 10, 0.3)).toBe(0);
    expect(binomTailLE(10, 10, 0.3)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// The normal quantile — no hardcoded 1.96
// ---------------------------------------------------------------------------

describe('zFor inverts the normal CDF', () => {
  it('recovers the textbook quantiles', () => {
    expect(zFor(0.95)).toBeCloseTo(1.959964, 3);
    expect(zFor(0.9)).toBeCloseTo(1.644854, 3);
    expect(zFor(0.99)).toBeCloseTo(2.575829, 3);
  });

  it('round-trips through the CDF it was solved against', () => {
    for (const conf of [0.8, 0.9, 0.95, 0.99]) {
      expect(normalCdf(zFor(conf))).toBeCloseTo(1 - (1 - conf) / 2, 4);
    }
  });
});

// ---------------------------------------------------------------------------
// Wilson
// ---------------------------------------------------------------------------

describe('the Wilson score interval', () => {
  it('matches its closed form', () => {
    const wins = 127;
    const n = 223;
    const p = wins / n;
    const z = 1.959964;
    const denom = 1 + (z * z) / n;
    const centre = (p + (z * z) / (2 * n)) / denom;
    const half = (z / denom) * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
    const iv = wilson(wins, n);
    expect(iv.lo).toBeCloseTo(centre - half, 6);
    expect(iv.hi).toBeCloseTo(centre + half, 6);
  });

  it('stays inside [0, 1] where the normal approximation would not', () => {
    const iv = wilson(0, 20);
    // `toBe(0)` would be the wrong assertion: the score interval's lower end at
    // zero wins is zero up to float error (1.4e-17 here), and the property that
    // matters is that it is not NEGATIVE, which a normal-approximation bar is.
    expect(iv.lo).toBeGreaterThanOrEqual(0);
    expect(iv.lo).toBeCloseTo(0, 12);
    expect(iv.hi).toBeGreaterThan(0);
    expect(iv.hi).toBeLessThan(1);
    expect(wilson(20, 20).hi).toBeCloseTo(1, 12);
    expect(wilson(20, 20).hi).toBeLessThanOrEqual(1);
    // The normal bar, for contrast: p ± z·√(p(1−p)/n) is exactly 0 at both ends
    // and cannot express the uncertainty a zero-win run still carries.
    expect(iv.hi).toBeGreaterThan(0.1);
  });

  it('narrows as the sample grows, at a fixed rate', () => {
    const widths = [223, 1000, 4000].map((n) => {
      const iv = wilson(Math.round(0.57 * n), n);
      return iv.hi - iv.lo;
    });
    expect(widths[1]!).toBeLessThan(widths[0]!);
    expect(widths[2]!).toBeLessThan(widths[1]!);
    // Halving the width costs 4x the matches: the reason a0-126 is a run and
    // not an argument.
    expect(widths[0]! / widths[2]!).toBeGreaterThan(3.5);
  });

  it('is widened, never narrowed, by a design effect', () => {
    const plain = wilson(127, 223, 0.95, 1);
    const clustered = wilson(127, 223, 0.95, 1.4);
    expect(clustered.lo).toBeLessThan(plain.lo);
    expect(clustered.hi).toBeGreaterThan(plain.hi);
  });

  /** The headline. If this ever passes as "separable", a0-126's finding changed. */
  it("a0-121's Warden number does not clear the ceiling", () => {
    const iv = wilson(127, 223);
    expect(iv.p).toBeCloseTo(0.5695, 4);
    expect(iv.lo).toBeLessThan(WIN_RATE_CEILING);
    expect(iv.hi).toBeGreaterThan(WIN_RATE_CEILING);
    // and the one-sided test says the same thing
    expect(binomTailGE(127, 223, WIN_RATE_CEILING)).toBeGreaterThan(0.05);
  });
});

// ---------------------------------------------------------------------------
// Clopper–Pearson
// ---------------------------------------------------------------------------

describe('the exact interval', () => {
  it('has exactly alpha/2 in each tail, which is what it is defined as', () => {
    const wins = 127;
    const n = 223;
    const iv = clopper(wins, n, 0.95);
    expect(binomTailGE(wins, n, iv.lo)).toBeCloseTo(0.025, 4);
    expect(binomTailLE(wins, n, iv.hi)).toBeCloseTo(0.025, 4);
  });

  it('contains the Wilson interval — it is the conservative one', () => {
    for (const [w, n] of [
      [127, 223],
      [5, 223],
      [40, 64],
    ] as const) {
      const cp = clopper(w, n);
      const wi = wilson(w, n);
      expect(cp.lo).toBeLessThanOrEqual(wi.lo + 1e-9);
      expect(cp.hi).toBeGreaterThanOrEqual(wi.hi - 1e-9);
    }
  });

  it('pins the ends', () => {
    expect(clopper(0, 12).lo).toBe(0);
    expect(clopper(12, 12).hi).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Clustering
// ---------------------------------------------------------------------------

describe('the design effect', () => {
  it('is 1 when clusters carry no signal', () => {
    // Every cluster splits the same way: no between-cluster variance beyond
    // what within-cluster sampling explains.
    const sizes = Array.from({ length: 32 }, () => 8);
    const wins = Array.from({ length: 32 }, () => 4);
    const c = designEffect(wins, sizes);
    expect(c.deff).toBeCloseTo(1, 2);
  });

  it('blows up when a cluster decides the match outright', () => {
    // Half the maps are Warden maps and half are not: the seven matches on a
    // seed are one observation, not seven.
    const sizes = Array.from({ length: 32 }, () => 7);
    const wins = Array.from({ length: 32 }, (_, i) => (i % 2 === 0 ? 7 : 0));
    const c = designEffect(wins, sizes);
    expect(c.icc).toBeGreaterThan(0.9);
    expect(c.deff).toBeGreaterThan(6);
    expect(c.effectiveN).toBeLessThan(40);
  });

  it('never reports a variance-reducing design effect', () => {
    // Perfectly balanced clusters give a negative raw ICC. It is reported and
    // floored, because "this run is worth MORE than its match count" is not a
    // claim an interval should be allowed to make.
    const sizes = Array.from({ length: 20 }, () => 6);
    const wins = Array.from({ length: 20 }, (_, i) => (i % 2 === 0 ? 3 : 3));
    const c = designEffect(wins, sizes);
    expect(c.deff).toBeGreaterThanOrEqual(1);
  });

  it('degenerates safely', () => {
    expect(designEffect([1], [7]).deff).toBe(1);
    expect(designEffect([], []).deff).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// The sample size
// ---------------------------------------------------------------------------

describe('sampleFor answers "run more matches" with a number', () => {
  it('is infinite for a rate at or under the ceiling', () => {
    expect(sampleFor(0.55, 0.55)).toBe(Infinity);
    expect(sampleFor(0.5, 0.55)).toBe(Infinity);
  });

  it('is monotone: the closer to the line, the more matches', () => {
    const ns = [0.7, 0.65, 0.6, 0.58, 0.57].map((p) => sampleFor(p, 0.55));
    for (let i = 1; i < ns.length; i++) expect(ns[i]!).toBeGreaterThan(ns[i - 1]!);
  });

  it('returns an n that actually separates', () => {
    for (const p of [0.57, 0.6, 0.65]) {
      const n = sampleFor(p, 0.55);
      expect(wilson(Math.round(p * n), n).lo).toBeGreaterThan(0.55);
    }
  });

  it('says a0-121 was an order of magnitude short of its own question', () => {
    expect(sampleFor(127 / 223, 0.55) / 223).toBeGreaterThan(8);
  });

  it('the exact variant asks for at least as many matches as the Wilson one', () => {
    for (const p of [0.57, 0.6, 0.65, 0.83]) {
      expect(sampleForExact(p, 0.55)).toBeGreaterThanOrEqual(sampleFor(p, 0.55));
      expect(clopper(Math.round(p * sampleForExact(p, 0.55)), sampleForExact(p, 0.55)).lo).toBeGreaterThan(0.55);
    }
  });

  it('scales by the design effect, in matches actually played', () => {
    expect(sampleForExact(0.6, 0.55, 0.95, 2)).toBeGreaterThan(sampleForExact(0.6, 0.55, 0.95, 1));
  });

  // `exactLoAbove` is the shortcut `sampleForExact` searches with, and it is only
  // allowed to be a shortcut if it agrees with the thing it replaces everywhere.
  // The first deep render of this brief wedged for 26 minutes of CPU inside the
  // long form; the identity below is what makes the short form safe to trust.
  it('exactLoAbove agrees with the Clopper-Pearson bound it stands in for', () => {
    for (const n of [8, 12, 40, 223, 255, 1024, 3584]) {
      for (let w = 0; w <= n; w += Math.max(1, Math.floor(n / 37))) {
        expect(exactLoAbove(w, n, WIN_RATE_CEILING)).toBe(clopper(w, n).lo > WIN_RATE_CEILING);
      }
    }
  });

  it('exactLoAbove holds the identity at other ceilings and confidences', () => {
    for (const ceiling of [0.3, 0.5, 0.55, 0.8]) {
      for (const conf of [0.9, 0.95, 0.99]) {
        for (const w of [0, 1, 7, 19, 33, 40]) {
          expect(exactLoAbove(w, 40, ceiling, conf)).toBe(clopper(w, 40, conf).lo > ceiling);
        }
      }
    }
  });

  // The regression itself: a rate a hair over the ceiling is the shape that used
  // to walk most of SAMPLE_SEARCH_CAP at 200 bisections per step. Wall-clock in a
  // unit test is a blunt instrument, so the bound is loose on purpose - it is
  // there to catch a return of the hang, not to police milliseconds.
  it('answers the near-the-line rates that used to wedge it', () => {
    const started = Date.now();
    for (const p of [0.5502, 0.5525, 0.5605, 0.57]) expect(sampleForExact(p, 0.55)).toBeGreaterThan(0);
    expect(Date.now() - started).toBeLessThan(10_000);
  });
});

// ---------------------------------------------------------------------------
// The shard fold
// ---------------------------------------------------------------------------

const row = (seed: number, lineup: string, winner: string): MatchRow =>
  ({
    seed,
    lineup,
    ok: true,
    failure: null,
    seconds: 800,
    winner,
    winnerClass: null,
    winnerTier: null,
    seats: { warden: 1, bolt: 1 },
    deaths: { warden: 1, bolt: 2 },
    leaves: { retreat: 10 },
    decisions: 5,
  }) as unknown as MatchRow;

const shard = (seeds: number[], winner: string): SectionRun => ({
  section: 'roster',
  label: 'the shipped cast',
  seeds,
  rotations: 1,
  ceilingSeconds: 1200,
  matches: seeds.map((s) => row(s, 'roster:rot0', winner)),
  leavesBy: { warden: { retreat: 10 * seeds.length } },
  decisionsBy: { warden: 5 * seeds.length },
  deathsBy: { warden: seeds.length },
  seatMatchesBy: { warden: seeds.length, bolt: seeds.length },
});

describe('mergeSections', () => {
  it('concatenates disjoint seed spans and sums the pools', () => {
    const merged = mergeSections([shard([1, 2], 'warden'), shard([3, 4], 'bolt')]);
    expect(merged.seeds).toEqual([1, 2, 3, 4]);
    expect(merged.matches).toHaveLength(4);
    expect(merged.decisionsBy['warden']).toBe(20);
    expect(merged.leavesBy['warden']!['retreat']).toBe(40);
    expect(merged.seatMatchesBy['bolt']).toBe(4);
    const w = winsBy(merged.matches, (r) => r.winner, seatsByCharacter);
    expect(w.find((x) => x.key === 'warden')!.wins).toBe(2);
  });

  it('refuses a seed claimed twice — the failure that would silently double-count', () => {
    expect(() => mergeSections([shard([1, 2], 'warden'), shard([2, 3], 'bolt')])).toThrow(/two shards/);
  });

  it('refuses shards that are not the same contest', () => {
    const a = shard([1], 'warden');
    expect(() => mergeSections([a, { ...shard([2], 'bolt'), section: 'class' }])).toThrow(/section/);
    expect(() => mergeSections([a, { ...shard([2], 'bolt'), rotations: 4 }])).toThrow(/rotations/);
    expect(() => mergeSections([a, { ...shard([2], 'bolt'), ceilingSeconds: 600 }])).toThrow(/ceiling/);
  });

  it('refuses an empty fold rather than inventing a run', () => {
    expect(() => mergeSections([])).toThrow(/no shards/);
  });

  it('orders the fold the way one process would have produced it', () => {
    const merged = mergeSections([shard([3, 4], 'bolt'), shard([1, 2], 'warden')]);
    expect(merged.matches.map((m) => m.seed)).toEqual([1, 2, 3, 4]);
  });
});

// ---------------------------------------------------------------------------
// The committed artifacts
// ---------------------------------------------------------------------------

const DATA = fileURLToPath(new URL('../reports/a0-126-data/', import.meta.url));
const load = (p: string): SectionRun => JSON.parse(readFileSync(`${DATA}${p}`, 'utf8')) as SectionRun;

describe("a0-126's own artifacts", () => {
  const deep = 'deep-shipped/roster.json';
  it.runIf(existsSync(`${DATA}${deep}`))('the deep roster run hung nowhere and holds a0-112 seeds', () => {
    const run = load(deep);
    expect(run.matches.filter((r) => r.failure === 'wall-clock' || r.failure === 'stalled')).toHaveLength(0);
    // a0-112's draw is a subset, so a0-121's own column is inside this one.
    for (let s = 1; s <= 32; s++) expect(run.seeds).toContain(s);
    // Every lineup ran every seed — a fold that dropped a shard would show here.
    const perLineup = new Map<string, number>();
    for (const m of run.matches) perLineup.set(m.lineup, (perLineup.get(m.lineup) ?? 0) + 1);
    for (const [, n] of perLineup) expect(n).toBe(run.seeds.length);
    expect(perLineup.size).toBe(run.rotations);
  });
});
