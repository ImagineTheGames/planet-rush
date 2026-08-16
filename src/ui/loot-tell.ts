/**
 * src/ui/loot-tell.ts — the PARTIAL-PICKUP tell. OWNER: UI Engineer (GDD §2.2).
 *
 * ── WHY THIS FILE EXISTS (a0-54) ────────────────────────────────────────────
 * The developer, 2026-08-16: *"Sometimes I am picking up more than one ore,
 * like, I'm picking up two, but it only registers as one on my cargo."*
 *
 * The sim is right and has been all along. The base hold is 2 (`SHIP_STATS`
 * `cargo`, `CARGO_BASE`), so a ship holding 1 that flies into a 2-ore chunk takes
 * 1 and leaves 1 floating — GDD §2.3 exactly as ratified, "a full hold leaves the
 * ore for anyone" — and the accounting is exact: the remainder stays in the
 * chunk, `ledgerAdd('looted')` records only what arrived, and a full bot match
 * journals every pickup at `min(chunk.amount, room)` with no mismatch (a0-52's
 * ore journal; the a0-54 verification run).
 *
 * **The defect is that the game says nothing.** The player sees two ore, gets
 * one, and has no way to learn that their own hold was the reason. `lootTake`
 * (a0-08) publishes the ore that ARRIVED, deliberately — but with nothing
 * publishing what was OFFERED, a `+1` over a 2-ore chunk is indistinguishable
 * from a miscount. `Ship.lootOffered` is the missing half (a0-54, `src/sim/step`),
 * and this file is the one line that spends it.
 *
 * ── WHAT IT SAYS, AND WHAT IT REFUSES TO SAY ────────────────────────────────
 * One short line at the ship, gone in a second: **`HOLD FULL · 1 LEFT`** — the
 * reason, then the ore that stayed behind. Register 2 (style-guide §8, GDD §4.7):
 * procedural, terse, and *the refusal names its reason in the first three words*,
 * which is why `HOLD FULL` leads and the count follows. Not a modal, not a
 * tutorial re-trigger — the onboarding line "Hold full — fly into your collection
 * field to bank" already exists and fires in onboarding, which is the wrong
 * moment: it teaches the rule before the rule has cost the player anything.
 *
 * It fires on a PARTIAL take and on nothing else. A take that fits is silent: a
 * message that appears on every pickup is a message the player stops reading, and
 * the tell for a pickup that worked is the pip row filling, which is already
 * there. And it never becomes a second full-hold flash — the pip row's own
 * flash-when-full (GDD §2.2, {@link ./ore-hud} `oreFlashOn`) already fires at this
 * instant, because a partial take always ends with `cargo === cargoCap`. That
 * flash says FULL; this line says *why that cost you ore*. Two tells stacked on
 * one fact is what the brief forbids, so this one adds only the reason.
 *
 * Pure and PixiJS-free, like every decision module in this directory — the Pixi
 * half is a Text in {@link ./hud}, and the tests are {@link ./hud.test}.
 */

import { AFFORD_EPSILON } from './affordability';

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------

/**
 * How long the line stands, seconds. "Gone in a second" (the brief): long enough
 * to read four words at a glance while flying, short enough that it is over
 * before the next chunk lands. Deliberately a touch longer than a press flash
 * ({@link ./press-feedback} `CONFIRM_SECONDS`) — that one confirms a thing the
 * player just did, this one explains a thing that happened *to* them.
 */
export const LOOT_TELL_SECONDS = 1.1;

/** Fraction of the life spent at full opacity before the fade starts, so the
 *  line is READ at full strength and only then leaves. */
export const LOOT_TELL_HOLD = 0.55;

/** Float slack on the end of the life, seconds. `time` is an accumulated match
 *  clock, so `(t0 + LIFE) - t0` lands a hair under LIFE and the last frame would
 *  otherwise draw the line at an alpha of 1e-15 — visible to a test, invisible to
 *  a player, and untrue either way. A nanosecond closes it and nothing wider. */
const LIFE_EPSILON = 1e-9;

// ---------------------------------------------------------------------------
// The model
// ---------------------------------------------------------------------------

/**
 * A partial take, as the HUD says it. Both numbers are the RAW ore the sim moved
 * — `taken + left === offered` exactly — so a reader (and a test) can check the
 * arithmetic of the line against the tick that produced it; only {@link text}
 * rounds, and it says how below.
 */
export interface PartialTake {
  /** Ore that ARRIVED in the hold — the `lootTake` half. */
  readonly taken: number;
  /** Ore LEFT FLOATING because the hold had no room for it. Still on the field
   *  for anyone, which is the design (GDD §2.3), not a loss. */
  readonly left: number;
  /**
   * The REASON, drawn in the muted chrome tone ({@link ./chrome} `TEXT_MUTED` —
   * "the words a player reads but does not act on"). Always `HOLD FULL`: a
   * partial take can end no other way, since `take` is clipped by `room` and
   * therefore leaves `cargo === cargoCap` exactly.
   */
  readonly reason: string;
  /**
   * The ORE COUNT, drawn in signal yellow — a count of ore, on the same terms as
   * the banked total and the hold pips (style-guide §2's allowed list). The
   * number is whole; see {@link leftNumeral}.
   */
  readonly count: string;
  /** The whole line as one string — `HOLD FULL · 1 LEFT`. What the player reads,
   *  and what a test asserts against without knowing how it is painted. */
  readonly text: string;
}

/** What joins the reason to the count. The HUD's own separator — `WAVE 1/5 ·
 *  Outer Drift`, `+34 XP · 266 TO NEXT` — not a new piece of punctuation. */
export const LOOT_TELL_SEP = ' · ';

/**
 * The tell for one tick's collection, or `null` when there is nothing to say.
 *
 * `taken` is `Ship.lootTake` and `offered` is `Ship.lootOffered`, both summed
 * over that tick by the sim. A take is partial exactly when more was offered than
 * arrived — the hold's cap is the only thing that can cause that, since `take` is
 * `min(chunk.amount, room)` and nothing else clips it.
 *
 * Silent on a FULL take (`offered <= taken`), silent on a tick where nothing was
 * collected, and silent on the float dust below: see {@link leftNumeral}.
 */
export function partialTake(taken: number, offered: number): PartialTake | null {
  if (!Number.isFinite(taken) || !Number.isFinite(offered)) return null;
  if (taken < 0 || offered <= 0) return null;
  const left = offered - taken;
  // The whole test, and the reason `lootOffered` exists: more was on offer than
  // the hold could accept. `AFFORD_EPSILON` forgives float, nothing wider.
  if (left <= AFFORD_EPSILON) return null;
  const reason = 'HOLD FULL';
  const count = `${leftNumeral(left)} LEFT`;
  return { taken, left, reason, count, text: `${reason}${LOOT_TELL_SEP}${count}` };
}

/**
 * The leftover as the HUD writes it: **whole ore, never zero**.
 *
 * Ore is whole everywhere the player reads it — one pip per slot, a whole banked
 * total, whole wheel costs — but a *chunk* can be fractional: mining chips land
 * fractional and a wreck's last piece is the remainder of the split
 * (`src/sim/match` `scatterWreckDebris`). So a real leftover is often 0.37 of an
 * ore, and both plain answers are wrong at 11–15px in one second: `0.37 LEFT` is
 * a decimal in a glance-read line (style-guide §8, "length is part of clarity"),
 * and `0 LEFT` is false — something IS still floating out there, and the player
 * can see it.
 *
 * So: round, and floor the result at 1. This is not a new rule; it is the one the
 * repair wedge already ships (`./build-wheel` `repairWedgeInfo`:
 * `+${Math.max(1, Math.round(restoreHp))} HP`), for the same reason — a number a
 * player acts on is never allowed to round away to nothing.
 */
export function leftNumeral(left: number): number {
  return Math.max(1, Math.round(left));
}

// ---------------------------------------------------------------------------
// The latch — a tick's pulse, held long enough to read
// ---------------------------------------------------------------------------

/** A standing tell and how strongly it is drawn this frame. */
export interface DrawnLootTell extends PartialTake {
  /** 1 while the line holds, easing to 0 as it leaves. */
  readonly alpha: number;
}

/**
 * Holds the last partial take on screen for {@link LOOT_TELL_SECONDS}.
 *
 * `Ship.lootTake`/`lootOffered` are ONE TICK wide — the sim clears both at the
 * top of every chunk step — so the pulse has to be latched somewhere or it would
 * be drawn for a single frame and never read. It is latched here, in the pure
 * half, so the timing is a unit test rather than a thing you have to catch a
 * screenshot of.
 *
 * A fresh partial take always replaces a standing one: the newest fact is the one
 * worth the line, and two of them stacked would be a queue nobody asked for.
 */
export class LootTellLatch {
  private tell: PartialTake | null = null;
  private since = 0;

  /**
   * Feed one frame's sim tells. `taken`/`offered` are the local ship's
   * `lootTake`/`lootOffered`; `time` is the frame's match time, seconds.
   */
  note(taken: number, offered: number, time: number): void {
    const fresh = partialTake(taken, offered);
    if (!fresh) return;
    this.tell = fresh;
    this.since = time;
  }

  /** The line to draw at `time`, or `null` when nothing is standing. */
  read(time: number): DrawnLootTell | null {
    if (!this.tell) return null;
    const elapsed = time - this.since;
    // A clock that went backwards (a rematch resets `world.time`) drops the tell
    // rather than freezing it on screen for a whole match.
    if (elapsed < 0 || elapsed >= LOOT_TELL_SECONDS - LIFE_EPSILON) {
      this.tell = null;
      return null;
    }
    const t = elapsed / LOOT_TELL_SECONDS;
    const alpha = t <= LOOT_TELL_HOLD ? 1 : 1 - (t - LOOT_TELL_HOLD) / (1 - LOOT_TELL_HOLD);
    return { ...this.tell, alpha };
  }

  /** Drop anything standing — a new match starts with a clean screen. */
  clear(): void {
    this.tell = null;
    this.since = 0;
  }
}
