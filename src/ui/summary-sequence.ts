/**
 * src/ui/summary-sequence.ts — the end-of-match summary as a CHOREOGRAPHED
 * SEQUENCE. OWNER: UI Engineer (brief `docs/briefs/pr-05-summary-sequence.md`;
 * plan `docs/progression-plan.md` §6 — the plan is the contract).
 *
 * > *"it needs to feel like a video game end match screen with the score counting
 * > up, the progress bar filling up to show you current level, whats left till
 * > next level as it fills up, and gives a rewarding animation as it fills up and
 * > completes"* — the developer, 2026-08-07.
 *
 * A screen with animations sprinkled on it and a choreographed beat are different
 * products, and the second one is what was asked for. So this module is a
 * **timeline**, not a tween helper: {@link buildSummary} fixes every number the
 * screen will ever show — once, before a frame exists — and {@link summaryFrame}
 * is a pure function of `(sequence, elapsed, skipped)` that reads that timeline at
 * one instant. `./end-of-match` keeps its own purity: the sequence is a *second*
 * model beside {@link ./end-of-match.EndOfMatchModel}, never a clock smuggled into
 * it.
 *
 * ---------------------------------------------------------------------------
 * THE FOUR RULES (plan §6.4), AND WHERE EACH ONE LIVES
 * ---------------------------------------------------------------------------
 *  1. **Skippable, always, onto the same numbers.** {@link SummaryFrameOptions}
 *     `skipped` resolves `elapsed` to {@link SummarySequence.duration} and nothing
 *     else changes — so a skipped screen is the watched screen's last frame *by
 *     construction*, not by a second code path that has to agree with the first.
 *     `summary-sequence.test.ts` still asserts it byte for byte at every 100 ms
 *     mark, because "by construction" is a claim a refactor can quietly break.
 *  2. **The animation never computes the numbers.** Every final value is an input:
 *     the counts come from pr-04's `MatchAccrual`, the XP from its `xpForMatch`,
 *     the levels from pr-03's curve, the lifetime total from pr-01's profile. This
 *     module interpolates *toward* them and rounds for display; it prices nothing.
 *  3. **`prefers-reduced-motion` collapses to the end state, level-up still
 *     marked.** Same resolution as a skip (`reducedMotion`), which is why the two
 *     can never disagree — and the level-up is a *state* (`leveledUp`), not an
 *     event, so a still frame carries it.
 *  4. The phone size is the layout's half of the work (`./end-of-match`
 *     `endOfMatchLayout`, and its 390 px tests).
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS MODULE DOES NOT DO
 * ---------------------------------------------------------------------------
 * **It does not write the profile.** The single write site is the wiring's, at
 * teardown, *before* the first frame of this sequence (GDD §4.8: the sim never
 * reads the profile, and a crash mid-match costs at most the current match). This
 * module is handed the lifetime total the player *started* the match with, which
 * is why the bar can begin where they left it.
 *
 * **It does not sound anything.** The four cues are pr-07's, and they are driven
 * off this model's monotonic counters (`ticks`, `levelsShown`, `barMoving`) by the
 * wiring — so a skipped sequence fires nothing, because the counters are read, not
 * queued.
 */

import { totalByTier, type MatchAccrual } from '../progression/accrual';
import { levelForXp, xpToNext, xpToReach } from '../progression/curve';
import type { MatchXp, XpRowKey } from '../progression/xp';

// ---------------------------------------------------------------------------
// The timeline's dials — plan §6.3. Durations are TUNABLE; the ORDER is not.
// ---------------------------------------------------------------------------

/**
 * Every duration in the sequence, in seconds, gathered here so a re-tune is one
 * diff (the discipline `../progression/xp.ts` uses for the weights).
 *
 * The plan states these as opening values and says so twice: *"Times are TUNABLE
 * opening values; the order and the rules are not."* What a test may assert is
 * therefore the shape — rows before the total, the total before the bar, the bar
 * before the settle — never a wall-clock number.
 */
export const SUMMARY_TIMING = {
  /** Beat 0: the result lands ALONE. The station-death ache gets its beat before
   *  anything brighter happens on top of it (GDD §4.7). TUNABLE */
  result: 1.2,
  /** Beat 1: how long between one row arriving and the next. TUNABLE */
  rowStagger: 0.18,
  /** Beat 1: how long a row's number takes to count up from 0. TUNABLE */
  rowCount: 0.5,
  /** How long a block takes to fade/rise in once it is due. TUNABLE */
  rowRise: 0.22,
  /** Beat 2: the XP total's own count-up — faster than the rows, so it reads as
   *  a summation of them rather than an eighth row. TUNABLE */
  xpTotal: 0.9,
  /** Beat 3: the FIRST bar fill. Always paid in full, however small the delta —
   *  plan §6.4's "almost no XP at all" case. TUNABLE */
  barFill: 1.4,
  /** Beat 3 again, after a level-up: every subsequent fill, capped. TUNABLE */
  barRefill: 0.5,
  /** Beat 4: complete, flash, reset, tick the readout. TUNABLE */
  levelUp: 0.8,
  /** Beat 5: the hold before the buttons take focus. TUNABLE */
  settle: 0.4,
  /** How often the count-up ticks — the ordinal pr-07's `xpTick` rides up. TUNABLE */
  tick: 0.06,
} as const;

/** How much of a level-up beat is the flash on a full bar; the rest is the bar
 *  reset and the readout ticking over. TUNABLE */
const LEVEL_UP_FLASH = 0.5;

/**
 * How many level-ups a player is made to watch before the rest are collapsed.
 *
 * Past this the bar jumps straight to the final level and the readout carries
 * `LEVEL 7 (+4)` — plan §6.4: *"Nobody needs to watch a bar fill five times, and
 * a first match after a long absence can do exactly that."* TUNABLE
 */
export const SUMMARY_MAX_LEVEL_UPS = 3;

/** The label on the match-time line under the headline. */
export const SUMMARY_MATCH_TIME_LABEL = 'MATCH TIME';

// ---------------------------------------------------------------------------
// The rows — plan §6.2's SHOW/BOTH column, and nothing else
// ---------------------------------------------------------------------------

/** The seven rows this screen draws. The eleven rows that *pay* are
 *  `../progression/xp.ts`'s; four of them are shown, four more pay without a row
 *  of their own, and the rest were cut with reasons in plan §6.2. */
export type SummaryRowKey =
  | 'oreMined'
  | 'damage'
  | 'shipKills'
  | 'stationKills'
  | 'distance'
  | 'shipsUsed'
  | 'oreUsed';

/** Draw order — fixed, so the timeline does not change shape with the match. */
export const SUMMARY_ROW_ORDER: readonly SummaryRowKey[] = [
  'oreMined',
  'damage',
  'shipKills',
  'stationKills',
  'distance',
  'shipsUsed',
  'oreUsed',
];

const ROW_LABELS: Record<SummaryRowKey, string> = {
  oreMined: 'ORE MINED',
  damage: 'DAMAGE DEALT',
  shipKills: 'SHIPS DESTROYED',
  stationKills: 'STATIONS DESTROYED',
  distance: 'DISTANCE TRAVELLED',
  shipsUsed: 'SHIPS USED',
  oreUsed: 'ORE USED',
};

/** The four rows that also pay, mapped to the priced row that pays them. The
 *  other three are flavour: distance would reward flying in circles, ships used
 *  would reward dying, and ore used is already counted as ore mined (§6.2). */
const ROW_PAYS: Partial<Record<SummaryRowKey, XpRowKey>> = {
  oreMined: 'oreMined',
  damage: 'damage',
  shipKills: 'shipKills',
  stationKills: 'stationKills',
};

/** One finished row: what happened, in its own unit, and what it paid. */
export interface SummaryRow {
  readonly key: SummaryRowKey;
  readonly label: string;
  /**
   * The final value — fixed at teardown, never derived from a frame.
   *
   * `null` means **not creditable to a real player**, and is drawn `—` rather
   * than `0`: the Crush kills most stations and entropy is not an attacker (plan
   * §1.3c, Trap 12). A stat that cannot be credited is not shown rather than
   * estimated.
   */
  readonly value: number | null;
  /** The unit's suffix, or `''`. Damage is shown in HP — the unit the player
   *  reads off every bar in the match. */
  readonly unit: string;
  /** XP this row paid, or `null` where the row pays none. */
  readonly xp: number | null;
}

// ---------------------------------------------------------------------------
// The sequence — every number, fixed, before the first frame
// ---------------------------------------------------------------------------

/** What the wiring hands over at teardown: the match, its price, and where the
 *  player's career stood *before* it was banked. */
export interface SummaryInput {
  /** The local seat's finished accrual (pr-04 `finalize()`), never another's:
   *  another player's stats are not yours to read (plan §Q2). */
  readonly accrual: MatchAccrual;
  /** That accrual, priced (pr-04 `xpForMatch`). Passed in rather than computed
   *  here so the screen and the profile write cannot disagree by a rounding. */
  readonly xp: MatchXp;
  /** Lifetime XP **before** this match — where the bar starts (plan §6.3 beat 3). */
  readonly startXp: number;
  /** Whether any station died in this match with nobody credited for it. Turns a
   *  zero station-kill row into `—`; a credited zero stays `0`. */
  readonly uncreditedStationDeaths?: boolean;
}

/** One stretch of bar, inside one level. */
export interface SummaryFill {
  /** The level the bar is drawn under while this stretch runs. */
  readonly level: number;
  readonly fromFrac: number;
  readonly toFrac: number;
  readonly fromXp: number;
  readonly toXp: number;
  /** When it starts, seconds from the sequence's own zero. */
  readonly start: number;
  /** How long it takes — {@link SUMMARY_TIMING.barFill} for the first,
   *  {@link SUMMARY_TIMING.barRefill} for every one after. */
  readonly seconds: number;
  /** Whether a level-up beat follows this stretch. */
  readonly levelUp: boolean;
}

/** The whole choreography, resolved. Nothing below is computed again per frame. */
export interface SummarySequence {
  readonly rows: readonly SummaryRow[];
  /** `04:12` — the clock under the headline. */
  readonly matchTime: string;
  /** What this match paid, all eleven priced rows, exactly as pr-04 totalled it. */
  readonly xpTotal: number;
  readonly startXp: number;
  readonly endXp: number;
  readonly startLevel: number;
  readonly endLevel: number;
  /** Levels gained this match — the `(+4)` of a collapsed readout. */
  readonly levelUps: number;
  /** Whether the level-ups past {@link SUMMARY_MAX_LEVEL_UPS} were collapsed into
   *  one jump to the final level. */
  readonly collapsed: boolean;
  readonly fills: readonly SummaryFill[];
  /** When the rows start arriving (the end of beat 0). */
  readonly rowsStart: number;
  readonly totalStart: number;
  readonly totalEnd: number;
  readonly barStart: number;
  readonly settleStart: number;
  /** The whole sequence, end to end. A frame past this is the settle, forever. */
  readonly duration: number;
}

/** A finite, non-negative number — junk folds rather than reaching a bar. */
function safeXp(xp: number): number {
  return Number.isFinite(xp) ? Math.max(0, xp) : 0;
}

function clamp01(t: number): number {
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

/** Ease-out cubic: fast, then settling. The count-up's shape, and the bar's. */
function easeOut(t: number): number {
  const c = clamp01(t);
  return 1 - (1 - c) ** 3;
}

/** Thin-space grouping, the same treatment the hangar gives a career total. */
function grouped(n: number): string {
  return Math.round(n).toLocaleString('en-US').replace(/,/g, ' ');
}

/** `04:12`, or `1:02:05` once a match runs past the hour. */
export function formatMatchTime(seconds: number): string {
  const s = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const secs = s % 60;
  const pad = (n: number): string => String(n).padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(secs)}` : `${pad(minutes)}:${pad(secs)}`;
}

/** Where an absolute lifetime total sits inside `level`, as a fraction of it.
 *  Unlike `curve.levelProgress` this may return exactly 1 — a bar arriving at a
 *  boundary is the level-up beat's whole cue, and a fill that stopped at 0.999
 *  would never complete. */
function fracInLevel(xp: number, level: number): number {
  const step = xpToNext(level);
  if (step <= 0) return 0;
  return clamp01((xp - xpToReach(level)) / step);
}

/**
 * Fix every number this screen will show, and lay the beats out in time.
 *
 * Pure: same input, same sequence, on every run and every machine. It reads the
 * curve and it reads the priced match; it decides no value of its own.
 */
export function buildSummary(input: SummaryInput): SummarySequence {
  const { accrual, xp } = input;
  const startXp = Math.round(safeXp(input.startXp));
  const xpTotal = Math.max(0, Math.round(safeXp(xp.total)));
  const endXp = startXp + xpTotal;
  const startLevel = levelForXp(startXp);
  const endLevel = levelForXp(endXp);
  const levelUps = Math.max(0, endLevel - startLevel);
  const collapsed = levelUps > SUMMARY_MAX_LEVEL_UPS;

  const paid = (key: SummaryRowKey): number | null => {
    const priced = ROW_PAYS[key];
    if (!priced) return null;
    return xp.rows.find((r) => r.key === priced)?.xp ?? 0;
  };

  const stationKills = Math.round(totalByTier(accrual.stationKills));
  const rows: SummaryRow[] = SUMMARY_ROW_ORDER.map((key) => ({
    key,
    label: ROW_LABELS[key],
    value: rowValue(key, accrual, stationKills, input.uncreditedStationDeaths === true),
    unit: key === 'damage' ? ' HP' : '',
    xp: paid(key),
  }));

  // --- the beats, in order -------------------------------------------------
  const rowsStart = SUMMARY_TIMING.result;
  const totalStart =
    rowsStart + Math.max(0, rows.length - 1) * SUMMARY_TIMING.rowStagger + SUMMARY_TIMING.rowCount;
  const totalEnd = totalStart + SUMMARY_TIMING.xpTotal;
  const barStart = totalEnd;

  const fills: SummaryFill[] = [];
  let cursorXp = startXp;
  let level = startLevel;
  let at = barStart;
  // Collapsed matches get ONE fill and ONE level-up beat, then the jump: the
  // reward beat survives, the repetition does not.
  const beats = collapsed ? 1 : levelUps;
  for (let i = 0; i < beats; i++) {
    const boundary = xpToReach(level + 1);
    const seconds = i === 0 ? SUMMARY_TIMING.barFill : SUMMARY_TIMING.barRefill;
    fills.push({
      level,
      fromFrac: fracInLevel(cursorXp, level),
      toFrac: 1,
      fromXp: cursorXp,
      toXp: boundary,
      start: at,
      seconds,
      levelUp: true,
    });
    at += seconds + SUMMARY_TIMING.levelUp;
    cursorXp = boundary;
    level += 1;
  }
  if (!collapsed) {
    // The last stretch — whatever XP is left inside the level the player ends in.
    // It is paid its FULL beat-3 duration when it is the only one, however small
    // the delta: the motion is constant and only the distance changes (§6.4).
    const seconds = fills.length === 0 ? SUMMARY_TIMING.barFill : SUMMARY_TIMING.barRefill;
    fills.push({
      level,
      fromFrac: fracInLevel(cursorXp, level),
      toFrac: fracInLevel(endXp, level),
      fromXp: cursorXp,
      toXp: endXp,
      start: at,
      seconds,
      levelUp: false,
    });
    at += seconds;
  }

  const settleStart = at;
  return {
    rows,
    matchTime: formatMatchTime(accrual.seconds),
    xpTotal,
    startXp,
    endXp,
    startLevel,
    endLevel,
    levelUps,
    collapsed,
    fills,
    rowsStart,
    totalStart,
    totalEnd,
    barStart,
    settleStart,
    duration: settleStart + SUMMARY_TIMING.settle,
  };
}

/** One row's final value, in its own unit. The only judgement here is the
 *  station-kill one, and it is the plan's: `—` rather than a guess. */
function rowValue(
  key: SummaryRowKey,
  a: MatchAccrual,
  stationKills: number,
  uncredited: boolean,
): number | null {
  switch (key) {
    case 'oreMined':
      return Math.round(a.oreMined);
    case 'damage':
      return Math.round(totalByTier(a.damageDealt));
    case 'shipKills':
      return Math.round(totalByTier(a.shipKills));
    case 'stationKills':
      return stationKills > 0 ? stationKills : uncredited ? null : 0;
    case 'distance':
      return Math.round(a.distance);
    case 'shipsUsed':
      return Math.round(a.shipsUsed);
    case 'oreUsed':
      return Math.round(a.oreUsed);
  }
}

// ---------------------------------------------------------------------------
// The per-frame model
// ---------------------------------------------------------------------------

/** Which beat the sequence is in. */
export type SummaryPhase = 'result' | 'rows' | 'total' | 'fill' | 'levelUp' | 'settle';

/** One row, this frame. */
export interface SummaryRowFrame {
  readonly key: SummaryRowKey;
  readonly label: string;
  /** How far in the row's arrival is, `[0, 1]` — the view's alpha and rise. */
  readonly appear: number;
  /** The counted-up value, `null` on an uncreditable row. */
  readonly value: number | null;
  /** What is drawn: `1 240 HP`, or `—`. */
  readonly text: string;
  /** `+84 XP`, once the count has landed. Null before that, and on the three
   *  flavour rows that pay nothing. */
  readonly xpText: string | null;
}

/** The sequence at one instant. A pure function of `(sequence, elapsed)`. */
export interface SummaryFrame {
  readonly phase: SummaryPhase;
  readonly rows: readonly SummaryRowFrame[];
  /** `04:12`. */
  readonly matchTime: string;
  readonly matchTimeAppear: number;
  /** The XP total's count-up, and its text. */
  readonly xpValue: number;
  readonly xpText: string;
  readonly xpAppear: number;
  /** The level bar block's arrival. */
  readonly barAppear: number;
  /** The level the readout is showing right now. */
  readonly level: number;
  /** `LEVEL 7`, or `LEVEL 7 (+4)` once a collapsed run has jumped. */
  readonly levelText: string;
  /** The bar's fill, `[0, 1]`. */
  readonly barFrac: number;
  /** `+34 XP · 266 TO NEXT` — the number that DID move, however small. */
  readonly progressText: string;
  /** The level-up flash, `[0, 1]`, decaying across the first half of beat 4. */
  readonly flash: number;
  /** Whether a level-up has landed — a STATE, so a still frame carries it. */
  readonly leveledUp: boolean;
  /** How many level-up beats have landed. The wiring cues `levelUp` when this
   *  goes up, which is why a skip fires none: it is read, not queued. */
  readonly levelsShown: number;
  /** Whether the bar is moving this frame (pr-07's bed rides this). */
  readonly barMoving: boolean;
  /** How far through the whole XP delta the bar is, `[0, 1]` — the bed's ride. */
  readonly barProgress: number;
  /** The count-up tick's ordinal — pr-07's `xpTick` pitches up with it. */
  readonly ticks: number;
  /** Whether the buttons may be pressed. False until the settle, so the first
   *  input skips and does not also press REMATCH (§6.4 rule 1). */
  readonly buttonsLive: boolean;
  /** Whether the sequence has finished. */
  readonly done: boolean;
}

/** How a frame is asked for. Both options resolve to the same end state, which is
 *  exactly the guarantee plan §6.4 rules 1 and 3 ask for. */
export interface SummaryFrameOptions {
  /** The player skipped: snap everything to final and jump to the settle. */
  readonly skipped?: boolean;
  /** The player's OS asked for less motion: the same end state, held from the
   *  first frame, level-up marked. */
  readonly reducedMotion?: boolean;
}

/**
 * Read the sequence at one instant.
 *
 * Deterministic and side-effect free — it is handed an elapsed time and it
 * returns a model. Nothing here reads a clock, and nothing here decides a value:
 * every number below is an interpolation between two numbers
 * {@link buildSummary} already fixed.
 */
export function summaryFrame(
  seq: SummarySequence,
  elapsed: number,
  options: SummaryFrameOptions = {},
): SummaryFrame {
  const snap = options.skipped === true || options.reducedMotion === true;
  const raw = Number.isFinite(elapsed) ? elapsed : 0;
  const e = snap ? seq.duration : Math.max(0, Math.min(seq.duration, raw));

  const rows = seq.rows.map((row, i): SummaryRowFrame => {
    const start = seq.rowsStart + i * SUMMARY_TIMING.rowStagger;
    const appear = clamp01((e - start) / SUMMARY_TIMING.rowRise);
    const counted = clamp01((e - start) / SUMMARY_TIMING.rowCount);
    const value = row.value === null ? null : Math.round(row.value * easeOut(counted));
    return {
      key: row.key,
      label: row.label,
      appear,
      value,
      text: value === null ? '—' : `${grouped(value)}${row.unit}`,
      // The XP a row earned lands BESIDE it as its count-up finishes (§6.3).
      xpText: counted >= 1 && row.xp !== null ? `+${grouped(row.xp)} XP` : null,
    };
  });

  const xpValue = Math.round(seq.xpTotal * easeOut((e - seq.totalStart) / SUMMARY_TIMING.xpTotal));
  const bar = barAt(seq, e);
  const gained = Math.max(0, Math.round(bar.xp - seq.startXp));
  const toNext = Math.max(0, Math.round(xpToReach(bar.level + 1) - bar.xp));
  const delta = seq.endXp - seq.startXp;

  return {
    phase: phaseAt(seq, e, bar),
    rows,
    matchTime: seq.matchTime,
    matchTimeAppear: clamp01((e - seq.rowsStart) / SUMMARY_TIMING.rowRise),
    xpValue,
    xpText: `+${grouped(xpValue)} XP`,
    xpAppear: clamp01((e - seq.totalStart) / SUMMARY_TIMING.rowRise),
    barAppear: clamp01((e - seq.totalStart) / SUMMARY_TIMING.rowRise),
    level: bar.level,
    levelText: `LEVEL ${bar.level}${seq.collapsed && bar.level === seq.endLevel ? ` (+${seq.levelUps})` : ''}`,
    barFrac: bar.frac,
    progressText: `+${grouped(gained)} XP · ${grouped(toNext)} TO NEXT`,
    flash: bar.flash,
    leveledUp: bar.shown > 0,
    levelsShown: bar.shown,
    barMoving: bar.moving,
    barProgress: delta > 0 ? clamp01((bar.xp - seq.startXp) / delta) : 0,
    ticks: ticksAt(seq, e),
    buttonsLive: e >= seq.settleStart,
    done: e >= seq.duration,
  };
}

/** The bar's state at one instant: which level it is under, how full it is, how
 *  much lifetime XP that represents, and how many level-ups have landed. */
interface BarState {
  level: number;
  frac: number;
  xp: number;
  flash: number;
  shown: number;
  moving: boolean;
  /** True while a level-up beat is running — the phase reads it. */
  levelling: boolean;
}

function barAt(seq: SummarySequence, e: number): BarState {
  const first = seq.fills[0];
  if (!first || e < seq.barStart) {
    // Before beat 3 the bar is drawn where the player STARTED the match.
    return {
      level: seq.startLevel,
      frac: fracInLevel(seq.startXp, seq.startLevel),
      xp: seq.startXp,
      flash: 0,
      shown: 0,
      moving: false,
      levelling: false,
    };
  }

  let shown = 0;
  for (let i = 0; i < seq.fills.length; i++) {
    const fill = seq.fills[i]!;
    const fillEnd = fill.start + fill.seconds;
    if (e < fillEnd) {
      const t = easeOut((e - fill.start) / fill.seconds);
      return {
        level: fill.level,
        frac: fill.fromFrac + (fill.toFrac - fill.fromFrac) * t,
        xp: fill.fromXp + (fill.toXp - fill.fromXp) * t,
        flash: 0,
        shown,
        moving: true,
        levelling: false,
      };
    }
    if (!fill.levelUp) break;

    const beatEnd = fillEnd + SUMMARY_TIMING.levelUp;
    if (e < beatEnd) {
      const t = (e - fillEnd) / SUMMARY_TIMING.levelUp;
      if (t < LEVEL_UP_FLASH) {
        // Complete, and flash: the bar is FULL under the level it just finished.
        return {
          level: fill.level,
          frac: 1,
          xp: fill.toXp,
          flash: 1 - t / LEVEL_UP_FLASH,
          shown,
          moving: false,
          levelling: true,
        };
      }
      // …then the readout ticks over and the bar is empty behind it. What it
      // ticks over TO is the next stretch's opening — or, on a collapsed run
      // where there is no next stretch, the final level itself.
      shown += 1;
      return { ...restAfter(seq, i), flash: 0, shown, moving: false, levelling: true };
    }
    shown += 1;
  }

  // Past every fill: the end state.
  return { ...restAfter(seq, seq.fills.length - 1), flash: 0, shown, moving: false, levelling: false };
}

/** Where the bar rests once fill `i` and its level-up beat are done: the next
 *  fill's opening, or the sequence's final state. */
function restAfter(seq: SummarySequence, i: number): { level: number; frac: number; xp: number } {
  const next = seq.fills[i + 1];
  if (next) return { level: next.level, frac: next.fromFrac, xp: next.fromXp };
  return { level: seq.endLevel, frac: fracInLevel(seq.endXp, seq.endLevel), xp: seq.endXp };
}

function phaseAt(seq: SummarySequence, e: number, bar: BarState): SummaryPhase {
  if (e >= seq.settleStart) return 'settle';
  if (e >= seq.barStart) return bar.levelling ? 'levelUp' : 'fill';
  if (e >= seq.totalStart) return 'total';
  if (e >= seq.rowsStart) return 'rows';
  return 'result';
}

/** The count-up's tick ordinal — monotonic, and frozen once the total lands (the
 *  bar's own bed takes over from there, pr-07 §6.5). */
function ticksAt(seq: SummarySequence, e: number): number {
  if (e <= seq.rowsStart) return 0;
  return Math.floor((Math.min(e, seq.totalEnd) - seq.rowsStart) / SUMMARY_TIMING.tick);
}
