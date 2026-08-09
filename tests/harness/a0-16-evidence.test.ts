/**
 * tests/harness/a0-16-evidence.test.ts — the a0-16 reproduction, as evidence.
 * OWNER: Gameplay Engineer.
 *
 * The brief asks for "a SCARCE match with the clock and the spawn in the same
 * frame: countdown reaching zero as the rocks land. Today those are 15 seconds
 * apart, and that gap is the whole brief." This produces exactly that as a
 * frame-by-frame trace of the real sim, stepped at the real `TICK_DT`, with two
 * countdowns side by side on every line:
 *
 *   - **BEFORE** — the clock as it shipped: `computeWaveClock(t)` taking
 *     `waveTime`'s baseline default, 150 s.
 *   - **AFTER** — the clock as it is now: the match's own `waveIntervalOf(world)`.
 *
 * …against `wavesSpawned` and the rock count, which is where the truth is. The
 * fifteen seconds of dead air between BEFORE hitting 0:00 and the rocks landing
 * is the bug, printed.
 *
 *     A0_16_WRITE_EVIDENCE=1 npx vitest run tests/harness/a0-16-evidence.test.ts
 *
 * writes `evidence/a0-16-wave-clock/trace.txt`. Without the env var the trace is
 * still computed and asserted, it is just not written — so CI never dirties the
 * tree. Every number printed is asserted below, so the committed artifact cannot
 * drift from the code.
 *
 * The strings are the ones the player actually reads: `formatClock`, the same
 * function the HUD prints into `NEXT m:ss`.
 */

import { describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ShipClass } from '../../src/shared/types';
import {
  DEFAULT_ABUNDANCE,
  TICK_DT,
  WAVE_COUNT,
  WAVE_INTERVAL_S,
  createWorld,
  step,
  waveIntervalOf,
  type Abundance,
  type World,
} from '../../src/sim';
import { computeWaveClock, formatClock } from '../../src/ui/wave-clock';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, '../../evidence/a0-16-wave-clock/trace.txt');

/** A two-slot match at one abundance level, with its real commons field — we are
 *  timing wave arrivals, so the rocks have to actually arrive. */
function matchAt(abundance: Abundance): World {
  return createWorld({
    seed: 11,
    players: [
      { id: 0, shipClass: ShipClass.Vanguard },
      { id: 1, shipClass: ShipClass.Vanguard },
    ],
    abundance,
  });
}

/** Step the real sim to (just under) a wall-clock time, on the tick grid. */
function stepTo(world: World, seconds: number): void {
  let guard = 0;
  while (world.time + TICK_DT <= seconds + 1e-9 && guard < 200_000) {
    step(world, [], TICK_DT);
    guard++;
  }
}

/** One frame: the HUD line the player would have read before the fix, the one
 *  they read now, and what the sim had actually done by then. Both clocks print
 *  what the HUD prints — `WAVE n/5` and `NEXT m:ss` — so a lie is legible as a
 *  lie: a BEFORE reading `WAVE 2` beside a sim reading `wave 1/5` is the clock
 *  announcing a wave that has not been delivered. */
function frame(world: World, label: string): string {
  const say = (c: ReturnType<typeof computeWaveClock>) =>
    `WAVE ${c.wave}  NEXT ${(c.countdownToNext === null ? 'FINAL' : formatClock(c.countdownToNext)).padStart(5)}`;
  const before = computeWaveClock(world.time, false, WAVE_INTERVAL_S);
  const after = computeWaveClock(world.time, false, waveIntervalOf(world));
  return [
    label.padEnd(15),
    `t=${world.time.toFixed(2).padStart(7)}s`,
    `BEFORE ${say(before)}`,
    `| AFTER ${say(after)}`,
    `| sim wave ${world.match.wavesSpawned}/${WAVE_COUNT}`,
    `rocks ${world.asteroids.length.toString().padStart(3)}`,
  ].join('  ');
}

describe('a0-16 evidence — the countdown and the rocks, in the same frame', () => {
  it('SCARCE: BEFORE empties 15 s early; AFTER lands on the spawn', () => {
    const lines: string[] = [];
    const world = matchAt('scarce');
    const interval = waveIntervalOf(world);

    // The gap the brief names, stated up front from the real numbers rather than
    // asserted as a literal.
    expect(DEFAULT_ABUNDANCE).toBe('scarce');
    expect(interval).toBeGreaterThan(WAVE_INTERVAL_S);
    const gap = interval - WAVE_INTERVAL_S;

    lines.push('a0-16 — "the wave clock counts down to the wrong time"');
    lines.push('');
    lines.push(
      `A default match: DEFAULT_ABUNDANCE=${DEFAULT_ABUNDANCE}, so this world's waves`,
    );
    lines.push(
      `land every ${interval.toFixed(1)} s (WAVE_INTERVAL_S ${WAVE_INTERVAL_S} × respawnInterval).`,
    );
    lines.push(
      `BEFORE = the HUD clock as it shipped, counting down the baseline ${WAVE_INTERVAL_S} s.`,
    );
    lines.push('AFTER  = the HUD clock now, counting down world.economy.waveInterval.');
    lines.push(`The gap between them is ${gap.toFixed(1)} s of dead air, below.`);
    lines.push('');
    lines.push('Reproduce: A0_16_WRITE_EVIDENCE=1 npx vitest run tests/harness/a0-16-evidence.test.ts');
    lines.push('');
    lines.push('--- SCARCE · the run-up to wave 2 (real sim, TICK_DT steps) ---');

    lines.push(frame(world, 'match start'));

    // Step to the last frame before the OLD clock's countdown runs out.
    const rocksBefore = world.asteroids.length;
    stepTo(world, WAVE_INTERVAL_S - TICK_DT);
    lines.push(frame(world, 'BEFORE at 0'));
    const atOldZero = computeWaveClock(world.time, false, WAVE_INTERVAL_S);
    expect(atOldZero.wave).toBe(1);
    expect(atOldZero.countdownToNext!).toBeLessThanOrEqual(TICK_DT + 1e-9);

    // One tick on, the shipped clock rolls the wave over: it now says WAVE 2 and
    // starts counting to a third wave. The sim has spawned one wave, and the
    // field has not gained a rock. This is the frame the brief is about.
    step(world, [], TICK_DT);
    lines.push(frame(world, 'BEFORE lies'));
    const rolled = computeWaveClock(world.time, false, WAVE_INTERVAL_S);
    expect(rolled.wave, 'the shipped clock announced wave 2').toBe(2);
    expect(world.match.wavesSpawned, 'the sim had delivered one wave').toBe(1);
    expect(world.asteroids.length, 'and not one new rock').toBe(rocksBefore);

    // The dead air: fifteen seconds in which the shipped clock has been showing a
    // wave that does not exist and nothing has spawned.
    for (let s = 3; s < gap; s += 3) {
      stepTo(world, WAVE_INTERVAL_S + s);
      lines.push(frame(world, `+${s.toFixed(0)}s dead air`));
      expect(world.match.wavesSpawned, 'still no wave').toBe(1);
      expect(world.asteroids.length, 'still no new rock').toBe(rocksBefore);
    }

    // The frame the rocks actually land on. Step until `wavesSpawned` ticks up,
    // and read both clocks at the start of that very frame.
    let landingLine = '';
    let landedAt = -1;
    let guard = 0;
    while (world.match.wavesSpawned < 2 && guard < 100_000) {
      const line = frame(world, 'ROCKS LAND');
      const afterAtFrame = computeWaveClock(world.time, false, interval);
      step(world, [], TICK_DT);
      if (world.match.wavesSpawned === 2) {
        landingLine = line;
        landedAt = world.time;
        // The whole claim of the fix, in two assertions: entering the frame the
        // wave lands on, the AFTER countdown is spent — within one tick of zero
        // (`formatClock` ceils, so the HUD shows 0:01 right up to the arrival and
        // never 0:00 with a wave still pending, which is the intended reading)…
        expect(afterAtFrame.countdownToNext!).toBeLessThanOrEqual(TICK_DT + 1e-9);
        expect(afterAtFrame.countdownToNext!).toBeGreaterThanOrEqual(0);
        // …and leaving it, the clock's wave number and the sim's turn over
        // together. That is the equality the shipped clock broke for 15 s.
        expect(computeWaveClock(world.time, false, interval).wave).toBe(
          world.match.wavesSpawned,
        );
      }
      guard++;
    }
    lines.push(landingLine);
    lines.push(frame(world, 'wave 2 in'));

    // …and the rocks really did arrive on that frame.
    expect(world.asteroids.length).toBeGreaterThan(rocksBefore);
    expect(landedAt).toBeGreaterThanOrEqual(interval - 1e-9);
    expect(landedAt).toBeLessThan(interval + TICK_DT + 1e-9);

    lines.push('');
    lines.push(
      `VERDICT: the shipped clock (BEFORE) emptied at t=${WAVE_INTERVAL_S.toFixed(2)}s and the rocks`,
    );
    lines.push(
      `         landed at t=${landedAt.toFixed(2)}s — ${gap.toFixed(1)} s apart, every default match.`,
    );
    lines.push(
      '         The fixed clock (AFTER) runs out on the landing frame itself, and',
    );
    lines.push(
      '         turns over to WAVE 2 on the same tick the sim does. It shows 0:01',
    );
    lines.push(
      '         rather than 0:00 right up to the arrival because formatClock ceils —',
    );
    lines.push(
      '         deliberately, so the HUD never reads 0:00 with a wave still pending.',
    );

    // --- The same tie at every level, from the table rather than a literal ---
    lines.push('');
    lines.push('--- every abundance · where the clock points vs where the wave lands ---');
    lines.push(
      'level     interval   clock target (wave 2)   spawner landed   BEFORE would have said',
    );
    for (const level of ['scarce', 'standard', 'rich'] as const) {
      const w = matchAt(level);
      const iv = waveIntervalOf(w);
      const target = computeWaveClock(0, false, iv).countdownToNext!;
      let g = 0;
      while (w.match.wavesSpawned < 2 && g < 100_000) {
        step(w, [], TICK_DT);
        g++;
      }
      // The clock's target IS the landing tick, to within the tick grid.
      expect(w.time).toBeGreaterThanOrEqual(target - 1e-9);
      expect(w.time).toBeLessThan(target + TICK_DT + 1e-9);
      lines.push(
        [
          level.padEnd(9),
          `${iv.toFixed(1).padStart(6)}s`,
          `${target.toFixed(2).padStart(15)}s`,
          `${w.time.toFixed(2).padStart(14)}s`,
          `${WAVE_INTERVAL_S.toFixed(2).padStart(18)}s`,
        ].join('  '),
      );
    }
    lines.push('');
    lines.push(
      'The right-hand column is the one number the clock used to print at every',
    );
    lines.push('level. It is right in exactly one of the three, and that one is not the default.');
    lines.push('');

    const text = lines.join('\n');
    if (process.env.A0_16_WRITE_EVIDENCE === '1') {
      mkdirSync(dirname(OUT), { recursive: true });
      writeFileSync(OUT, text, 'utf8');
    }
    expect(text).toContain('ROCKS LAND');
  });
});
