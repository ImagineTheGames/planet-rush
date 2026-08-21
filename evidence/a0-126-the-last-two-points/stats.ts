/**
 * evidence/a0-126-the-last-two-points/stats.ts — the interval arithmetic.
 * OWNER: QA Agent (brief a0-126).
 *
 * a0-121 published Warden at 127/223 = 57.0% against a 55% ceiling and called it
 * "2.0 points short". This module exists because **2.0 points on 223 decided
 * matches is about four matches**, and a tuning change made on four matches of
 * signal is not defensible. Everything here answers one question: is 57.0%
 * distinguishable from 55% at this sample size, and if not, how many matches
 * would it take?
 *
 * `harness/mirrors` already exports `winSE` — the normal-approximation standard
 * error — and every prior report quotes it. That is the right number for "did
 * this move", which is what those reports asked. It is the wrong number for
 * "is this over a fixed line", because a ±1 SE bar is a 68% interval and a
 * ceiling test is one-sided. So this file adds, and does not replace:
 *
 *   - `wilson`      — the score interval, which is what a proportion CI should
 *                     be at any n (it does not run off the end of [0,1] and it
 *                     does not need the normal approximation to be good).
 *   - `clopper`     — the exact interval, by bisection on the binomial tail, as
 *                     the conservative cross-check on Wilson.
 *   - `binomTailGE` — the exact one-sided p-value against a fixed ceiling.
 *   - `designEffect`— the variance inflation from **clustering**: these are not
 *                     223 independent matches. They are 32 map draws, each
 *                     played 7 times. If a seed's map suits Warden, all 7 of its
 *                     matches lean the same way, and the binomial interval —
 *                     which assumes 223 independent coin flips — is too narrow.
 *   - `sampleFor`   — the n at which a given true rate becomes separable.
 *
 * No number in this file reads a clock or a random source. Given the same
 * artifact it prints the same interval.
 */

/** Natural log of n!, via lgamma, so binomial tails at n = 10^5 stay exact. */
export function lnFactorial(n: number): number {
  return lnGamma(n + 1);
}

/** Lanczos approximation. Accurate to ~1e-13 over the range this file uses. */
export function lnGamma(z: number): number {
  const g = 7;
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6,
    1.5056327351493116e-7,
  ];
  if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - lnGamma(1 - z);
  const zz = z - 1;
  let x = c[0]!;
  for (let i = 1; i < g + 2; i++) x += c[i]! / (zz + i);
  const t = zz + g + 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (zz + 0.5) * Math.log(t) - t + Math.log(x);
}

/** ln P(X = k) for X ~ Binomial(n, p). */
export function lnBinomPmf(k: number, n: number, p: number): number {
  if (p <= 0) return k === 0 ? 0 : -Infinity;
  if (p >= 1) return k === n ? 0 : -Infinity;
  return lnFactorial(n) - lnFactorial(k) - lnFactorial(n - k) + k * Math.log(p) + (n - k) * Math.log(1 - p);
}

/** P(X >= k) for X ~ Binomial(n, p) — the exact upper tail. */
export function binomTailGE(k: number, n: number, p: number): number {
  if (k <= 0) return 1;
  if (k > n) return 0;
  let sum = 0;
  for (let i = k; i <= n; i++) sum += Math.exp(lnBinomPmf(i, n, p));
  return Math.min(1, sum);
}

/** P(X <= k) for X ~ Binomial(n, p) — the exact lower tail. */
export function binomTailLE(k: number, n: number, p: number): number {
  if (k >= n) return 1;
  if (k < 0) return 0;
  let sum = 0;
  for (let i = 0; i <= k; i++) sum += Math.exp(lnBinomPmf(i, n, p));
  return Math.min(1, sum);
}

export interface Interval {
  readonly lo: number;
  readonly hi: number;
  /** The point estimate the interval is around. */
  readonly p: number;
  /** Coverage, e.g. 0.95. */
  readonly conf: number;
}

/** Two-sided normal quantile, for the confidence levels this report uses. */
export function zFor(conf: number): number {
  // Bisection on the standard normal CDF — no table, no magic 1.96.
  const target = 1 - (1 - conf) / 2;
  let lo = 0;
  let hi = 10;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (normalCdf(mid) < target) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Standard normal CDF via the error function (Abramowitz & Stegun 7.1.26). */
export function normalCdf(x: number): number {
  return 0.5 * (1 + erf(x / Math.SQRT2));
}

export function erf(x: number): number {
  const s = x < 0 ? -1 : 1;
  const a = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * a);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-a * a);
  return s * y;
}

/**
 * Wilson score interval. The default reading for a proportion: it is the set of
 * p for which the score test does not reject, so it inverts the same test a
 * ceiling comparison is, and it stays inside [0,1] at any n.
 *
 * `deff` inflates the variance for clustering (§ `designEffect`); pass 1 for the
 * plain independent-matches reading.
 */
export function wilson(wins: number, n: number, conf = 0.95, deff = 1): Interval {
  if (n <= 0) return { lo: 0, hi: 1, p: 0, conf };
  const p = wins / n;
  const nEff = n / Math.max(deff, 1e-9);
  const z = zFor(conf);
  const denom = 1 + (z * z) / nEff;
  const centre = (p + (z * z) / (2 * nEff)) / denom;
  const half = (z / denom) * Math.sqrt((p * (1 - p)) / nEff + (z * z) / (4 * nEff * nEff));
  return { lo: Math.max(0, centre - half), hi: Math.min(1, centre + half), p, conf };
}

/**
 * Clopper–Pearson exact interval, found by bisection on the binomial tails
 * rather than by an incomplete-beta inverse. Conservative by construction — it
 * is the cross-check on Wilson, not the headline.
 */
export function clopper(wins: number, n: number, conf = 0.95): Interval {
  const alpha = 1 - conf;
  const p = n > 0 ? wins / n : 0;
  const solve = (f: (q: number) => number, target: number): number => {
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 200; i++) {
      const mid = (lo + hi) / 2;
      if (f(mid) > target) hi = mid;
      else lo = mid;
    }
    return (lo + hi) / 2;
  };
  const lo = wins === 0 ? 0 : solve((q) => binomTailGE(wins, n, q), alpha / 2);
  const hi = wins === n ? 1 : solve((q) => 1 - binomTailLE(wins, n, q), 1 - alpha / 2);
  return { lo, hi, p, conf };
}

/**
 * The intra-cluster correlation and the variance inflation it implies, by the
 * standard one-way ANOVA estimator on equal-ish clusters.
 *
 * The roster contest is **32 seeds × 7 rotations**. A seed is one map draw —
 * ore field, base placement, wave schedule — held fixed while the seating
 * rotates. Two matches from the same seed are therefore not independent
 * observations of "does Warden win": they share the board. If Warden's edge is
 * partly the map, the seed-level win counts are more spread out than binomial
 * sampling alone would make them, and every interval computed as though there
 * were 223 free observations is too narrow by the factor returned here.
 *
 * `deff = 1 + (m - 1) * icc`, `m` the mean cluster size. `icc` is floored at 0:
 * a negative estimate means under-dispersion, which cannot make an interval
 * *narrower* than binomial in any defensible reading, so it is reported and not
 * applied.
 */
export interface Clustering {
  readonly clusters: number;
  readonly meanSize: number;
  /** Raw ANOVA estimate, which may be negative. */
  readonly iccRaw: number;
  /** `max(0, iccRaw)` — what `deff` uses. */
  readonly icc: number;
  readonly deff: number;
  /** `n / deff` — the number of independent matches this run is worth. */
  readonly effectiveN: number;
}

export function designEffect(clusterWins: readonly number[], clusterSizes: readonly number[]): Clustering {
  const k = clusterWins.length;
  const n = clusterSizes.reduce((a, b) => a + b, 0);
  const wins = clusterWins.reduce((a, b) => a + b, 0);
  if (k < 2 || n <= k) {
    return { clusters: k, meanSize: k ? n / k : 0, iccRaw: 0, icc: 0, deff: 1, effectiveN: n };
  }
  const pBar = wins / n;
  // Mean square between and within, on the binary outcome.
  let msb = 0;
  let msw = 0;
  for (let i = 0; i < k; i++) {
    const m = clusterSizes[i]!;
    if (m === 0) continue;
    const pi = clusterWins[i]! / m;
    msb += m * (pi - pBar) ** 2;
    msw += m * pi * (1 - pi) * (m / Math.max(m - 1, 1));
  }
  msb /= k - 1;
  msw /= n - k;
  // m0: the ANOVA cluster-size constant, which equals m when sizes are equal.
  const sumSq = clusterSizes.reduce((a, b) => a + b * b, 0);
  const m0 = (n - sumSq / n) / (k - 1);
  const iccRaw = msb + (m0 - 1) * msw === 0 ? 0 : (msb - msw) / (msb + (m0 - 1) * msw);
  const icc = Math.max(0, iccRaw);
  const meanSize = n / k;
  const deff = 1 + (meanSize - 1) * icc;
  return { clusters: k, meanSize, iccRaw, icc, deff, effectiveN: n / deff };
}

/**
 * The n at which a true rate of `p` is separable from `ceiling` — the smallest
 * sample where a run that lands exactly on `p` would have its lower confidence
 * bound clear the ceiling. Answers "run more matches" with a number instead of
 * a shrug.
 */
export const SAMPLE_SEARCH_CAP = 200_000;

/**
 * Binary search on n, not a ladder: the lower bound rises monotonically with n
 * at fixed p, so a ladder that steps 2% at a time spends ~300 evaluations where
 * 18 will do — and for the *exact* variant each evaluation is a 200-step
 * bisection over O(n) tail sums, which makes the difference a hang rather than
 * a slowdown.
 *
 * Capped at {@link SAMPLE_SEARCH_CAP}: a rate a hair over the ceiling needs an
 * unbounded sample, and "more matches than this project will ever run" is
 * better reported as `Infinity` than searched for.
 */
function smallestN(separates: (n: number) => boolean): number {
  if (!separates(SAMPLE_SEARCH_CAP)) return Infinity;
  let lo = 1;
  let hi = SAMPLE_SEARCH_CAP;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (separates(mid)) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

export function sampleFor(p: number, ceiling: number, conf = 0.95, deff = 1): number {
  if (p <= ceiling) return Infinity;
  return smallestN((n) => wilson(Math.round(p * n), n, conf, deff).lo > ceiling);
}

/**
 * The same question against the **exact** interval, which is the one the verdict
 * is read off (`targets.ts` `verdictOf`). Quoting a Wilson-sized sample beside a
 * Clopper–Pearson verdict would understate the run a lane has to fund — at the
 * knife edge the two differ by a factor, not a rounding.
 *
 * `deff` has no exact analogue, so a clustered design is handled by asking for
 * `n × deff` matches: the exact interval is computed on the effective count and
 * the answer is scaled back up to matches actually played.
 */
export function sampleForExact(p: number, ceiling: number, conf = 0.95, deff = 1): number {
  if (p <= ceiling) return Infinity;
  // Bracketed below by the Wilson answer, which is always the smaller of the
  // two, then walked up in 1% steps: the exact bound is a step function of n
  // (`wins` is an integer) and is not perfectly monotone across a single step,
  // so it is confirmed upward rather than bisected.
  const start = sampleFor(p, ceiling, conf);
  if (!Number.isFinite(start)) return Infinity;
  for (let n = Math.max(8, start); n <= SAMPLE_SEARCH_CAP; n += Math.max(1, Math.floor(n * 0.01))) {
    if (exactLoAbove(Math.round(p * n), n, ceiling, conf)) return Math.ceil(n * Math.max(deff, 1));
  }
  return Infinity;
}

/**
 * `clopper(wins, n, conf).lo > ceiling`, decided without finding `lo`.
 *
 * The Clopper–Pearson lower bound is the q solving `P(X >= wins | q) = alpha/2`,
 * and that tail is increasing in q, so the bound clears the ceiling exactly when
 * the tail *at* the ceiling is already below alpha/2. One tail sum answers what
 * {@link clopper} spends a 200-step bisection over tail sums to answer.
 *
 * This is an identity, not an approximation — but it is the difference between a
 * report that renders and one that does not. {@link sampleForExact} walks up to
 * {@link SAMPLE_SEARCH_CAP} in 1% steps, ~1050 of them, and a contestant sitting
 * a hair over the ceiling walks most of that range: 200 bisection steps × O(n)
 * per step × 1050 is tens of minutes of CPU per target, which is how the first
 * deep render of this brief was found wedged rather than slow. The same call
 * against the tail directly is ~1050 × O(n), and returns in seconds.
 */
export function exactLoAbove(wins: number, n: number, ceiling: number, conf = 0.95): boolean {
  if (wins <= 0) return false; // lo is pinned at 0; 0 > ceiling is false for any ceiling >= 0.
  return binomTailGE(wins, n, ceiling) < (1 - conf) / 2;
}

/**
 * McNemar's exact test on a **paired** before/after run.
 *
 * Every table in this series compares two columns measured on the same seeds,
 * and then reads the difference through two independent standard errors. That
 * throws away the pairing, which is the whole reason the same seeds were used:
 * a match that both trees won and a match that both trees lost carry no
 * information about the change at all, and only the **discordant** matches do.
 *
 * So the right test on "did this constant move the win rate" is not two
 * intervals that happen to overlap or not — it is the exact binomial test on
 * `b` against `b + c`, where `b` is the matches won before and lost after and
 * `c` the reverse. That is strictly more sensitive than the unpaired reading,
 * and a0-126 needs it in both directions: it is what lets the report say that
 * a0-121's −16 points is real beyond argument while its residual +2 is not.
 */
export interface Paired {
  /** Both columns won it. */
  readonly both: number;
  /** Won before, lost after. */
  readonly lostIt: number;
  /** Lost before, won after. */
  readonly gained: number;
  /** Neither column won it. */
  readonly neither: number;
  readonly discordant: number;
  /** Two-sided exact p-value on the discordant pairs. */
  readonly p: number;
  readonly beforeRate: number;
  readonly afterRate: number;
}

export function mcnemar(
  before: readonly boolean[],
  after: readonly boolean[],
): Paired {
  if (before.length !== after.length) throw new Error('mcnemar: unpaired inputs');
  let both = 0;
  let lostIt = 0;
  let gained = 0;
  let neither = 0;
  for (let i = 0; i < before.length; i++) {
    if (before[i] && after[i]) both++;
    else if (before[i]) lostIt++;
    else if (after[i]) gained++;
    else neither++;
  }
  const n = lostIt + gained;
  // Exact two-sided binomial test at p = 1/2 on the discordant pairs.
  const k = Math.min(lostIt, gained);
  const p = n === 0 ? 1 : Math.min(1, 2 * binomTailLE(k, n, 0.5));
  const total = before.length;
  return {
    both,
    lostIt,
    gained,
    neither,
    discordant: n,
    p,
    beforeRate: total ? (both + lostIt) / total : 0,
    afterRate: total ? (both + gained) / total : 0,
  };
}

/** Points, for a report that talks in points. */
export const pts = (x: number, d = 1): string => `${(x * 100).toFixed(d)}`;
export const pctOf = (x: number, d = 1): string => `${(x * 100).toFixed(d)}%`;
