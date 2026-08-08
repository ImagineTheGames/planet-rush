/**
 * tests/live-stage/alarm-once-and-ownership.spec.ts — the alarm ANNOUNCES once and
 * belongs to one station, proven by real damage in the REAL booted client.
 * OWNER: Sound Agent (s9-01; GDD §2.2, amended 2026-08-07).
 *
 * THE DEVELOPER'S SENTENCE, WHICH IS TWO CLAIMS
 * ---------------------------------------------------------------------------
 * 2026-08-07: *"also for the alarm, it should only play once, and not keep
 * playing (and should only play for your station not others)..."*
 *
 * `./alarm-ownership-online.spec.ts` proves the second half's *wiring* — that the
 * engine listens as the seat the server gave this client, on a non-zero slot —
 * but it reads a fresh match, so it stops at `sounds: 0`. Nothing was ever shot.
 * This file is the other half: it actually sieges cores in the shipped bundle and
 * watches what the mix does about it.
 *
 * WHAT A UNIT TEST ALREADY PROVES, AND WHY THIS STILL EXISTS
 * ---------------------------------------------------------------------------
 * `src/art/audio/audio.test.ts` drives the same rules through the real
 * `AudioEngine` against a recording AudioContext, and it is the finer instrument
 * — it can see the buffer start. What it cannot see is whether the *client* ever
 * hands the engine that damage: the s9-01 defect was entirely in what `main.ts`
 * told the engine, and every one of those unit tests passed straight through it
 * (LESSONS §1). So this drives the sim's own damage path in a booted client and
 * reads the count back off `window.__alarmStage`, which is the same seam the
 * online spec asserts the *seat* on.
 *
 * HOW IT SIEGES
 * ---------------------------------------------------------------------------
 * Through the `?debug=1` write seam (`debug-hook.ts installDebugStage`), which
 * queues a damage verb that `main.ts` drains on a tick boundary through the sim's
 * OWN `damageStation` — not a poke at world state. A core only emits `coreHit`
 * when its HP actually falls (`art/vfx/observer.ts`), which is what the alarm's
 * pressure integrates, so this is the real siege path and not a synthesised tell.
 *
 * It is an OFFLINE match, so the local slot is 0 — deliberately not where the
 * ownership *wire* is proven (slot 0 is exactly the seat on which a dead wire
 * reads correct; that claim belongs to the online spec, on a non-zero slot, and
 * to the `local: 3` unit test). What is proven here is the part that needs real
 * damage: one sting for a five-second siege, and none at all for someone else's.
 */
import { test, expect } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** Where the run leaves its readout. Sound cannot screenshot; the attestation is
 *  numbers — HP that fell, and the sting count that did or did not move. */
const EVIDENCE = resolve(import.meta.dirname, '..', '..', 'evidence', 's9-01-alarm-once.json');

/** The s9-01 read-back seam (`installAlarmStage` in `src/main.ts`), on both boots. */
interface AlarmReading {
  /** The slot the AUDIO ENGINE is listening as. */
  local: number;
  /** The slot the rest of `main.ts` is flying. */
  localPlayer: number;
  /** Whose home damage rings this client's alarm — you alone in FFA. */
  allies: readonly number[];
  active: boolean;
  engagements: number;
  /** Stings actually SOUNDED. One per engagement is the whole brief. */
  sounds: number;
}
interface AlarmSeam {
  read(): AlarmReading;
}

/** The `?debug=1` write seams merged onto `window.__planetRush`. */
interface DebugStageSurface {
  damageCore(player: number, amount: number): unknown;
  coreHp(player: number): number | null;
}

interface StageWindow {
  __alarmStage?: AlarmSeam;
  __planetRush?: DebugStageSurface;
}
declare const window: Window & StageWindow;

/** One frame's worth of core damage. Small on purpose: the alarm integrates the
 *  *tell*, one per frame the core falls, not the size of the bite — so this is
 *  the gentlest siege that still lands, and it leaves the core alive. A dead home
 *  would pull in the three seconds of quiet (GDD §4.7), a different rule. */
const PER_FRAME = 0.1;
/** Stop biting here, so no phase can ever destroy the core mid-assertion. */
const HP_FLOOR = 20;
/** Twice `MIN_HOLD_S` and then some: long enough that a loop, or a per-frame
 *  re-trigger, would be unmistakable in the count (≈300 frames, ≈300 stings). */
const SIEGE_MS = 5_000;

interface SiegeReport {
  frames: number;
  hits: number;
  hpStart: number | null;
  hpEnd: number | null;
  /** The highest and lowest sting count seen on ANY frame of the siege — the
   *  pair that catches a klaxon that keeps playing. */
  maxSounds: number;
  minSounds: number;
  maxEngagements: number;
  everActive: boolean;
  end: AlarmReading;
}

/**
 * Siege `player`'s core for `ms`, sampling the alarm on every single frame.
 *
 * Sampling per frame rather than reading once at the end is the point: "it should
 * only play once, and not keep playing" is a claim about every instant of the
 * siege, and an end-state read would look identical whether the sting fired once
 * or three hundred times.
 */
async function siege(
  page: import('@playwright/test').Page,
  player: number,
  ms: number,
): Promise<SiegeReport> {
  return page.evaluate(
    async ([target, duration, perFrame, floor]) => {
      const rush = window.__planetRush!;
      const alarm = window.__alarmStage!;
      const frame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));
      const hpStart = rush.coreHp(target);
      let frames = 0;
      let hits = 0;
      let maxSounds = -Infinity;
      let minSounds = Infinity;
      let maxEngagements = -Infinity;
      let everActive = false;
      const started = performance.now();
      while (performance.now() - started < duration) {
        await frame();
        frames++;
        const hp = rush.coreHp(target);
        if (hp !== null && hp > floor) {
          rush.damageCore(target, perFrame);
          hits++;
        }
        const r = alarm.read();
        if (r.sounds > maxSounds) maxSounds = r.sounds;
        if (r.sounds < minSounds) minSounds = r.sounds;
        if (r.engagements > maxEngagements) maxEngagements = r.engagements;
        if (r.active) everActive = true;
      }
      return {
        frames,
        hits,
        hpStart,
        hpEnd: rush.coreHp(target),
        maxSounds,
        minSounds,
        maxEngagements,
        everActive,
        end: alarm.read(),
      };
    },
    [player, ms, PER_FRAME, HP_FLOOR] as const,
  );
}

test('the alarm sounds ONCE for a sustained siege on YOUR core, and never for another station (s9-01)', async ({
  page,
}) => {
  test.setTimeout(180_000);
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));

  // A live sim — no ?freeze. The alarm is a time-integrating state machine; a
  // pinned frame has nothing for it to integrate.
  await page.goto('/?debug=1', { waitUntil: 'load' });
  await page.waitForSelector('canvas', { state: 'attached', timeout: 30_000 });
  await page.waitForFunction(() => typeof window.__alarmStage?.read === 'function', undefined, {
    timeout: 30_000,
  });
  await page.waitForFunction(() => typeof window.__planetRush?.damageCore === 'function', undefined, {
    timeout: 30_000,
  });

  // --- The baseline, and who the mix thinks we are. -------------------------
  const base = await page.evaluate(() => window.__alarmStage!.read());
  expect(base.local, 'the engine agrees with the ship main.ts is flying').toBe(base.localPlayer);
  expect(base.allies, 'an offline FFA match is a side of one — your own home').toEqual([base.local]);
  expect(base.sounds, 'nothing has been shot, so nothing has rung').toBe(0);
  expect(base.engagements, 'and no engagement has been raised').toBe(0);
  const me = base.local;

  // Pick a rival that actually has a station to shoot at.
  const other = await page.evaluate((mine) => {
    for (let p = 0; p < 8; p++) {
      if (p !== mine && window.__planetRush!.coreHp(p) !== null) return p;
    }
    return null;
  }, me);
  expect(other, 'the offline match staged at least one rival station to shoot at').not.toBeNull();

  // Spawn protection refuses damage outright (`damageStation`), so wait until a
  // bite actually lands rather than racing it and calling the alarm broken.
  await page.waitForFunction(
    (mine) => {
      const before = window.__planetRush!.coreHp(mine);
      window.__planetRush!.damageCore(mine, 0.5);
      return before !== null && before > 0;
    },
    me,
    { timeout: 30_000 },
  );
  await page.waitForFunction(
    (mine) => {
      window.__planetRush!.damageCore(mine, 0.5);
      const hp = window.__planetRush!.coreHp(mine);
      return hp !== null && hp < 100;
    },
    me,
    { timeout: 30_000, polling: 100 },
  );

  // --- PHASE A. Five seconds of fire on YOUR core. --------------------------
  // The defect, verbatim: this used to start a LOOP and hold it for the whole
  // siege. One sting is the fix, and `maxSounds` is where a loop would show.
  const mine = await siege(page, me, SIEGE_MS);
  expect(mine.hits, 'the siege actually landed bites on the core').toBeGreaterThan(30);
  expect(mine.hpEnd!, 'and the core really lost HP — this is the sim, not a synthesised tell').toBeLessThan(
    mine.hpStart!,
  );
  expect(mine.everActive, 'sustained fire on your own home raised the alarm').toBe(true);
  expect(mine.end.engagements, 'one engagement, not one per frame').toBe(1);
  expect(
    mine.maxSounds,
    `the klaxon ANNOUNCED once and did not keep playing — it sounded ${mine.maxSounds} times across ${mine.frames} frames of siege`,
  ).toBe(1);
  expect(mine.end.sounds, 'and it is still one at the end of five seconds of fire').toBe(1);

  // --- PHASE B. Stop shooting; the state machine releases. ------------------
  // `MIN_HOLD_S` (2.5 s) and the lower `RELEASE` are kept from the looping
  // design, doing a new job: the re-trigger guard. Nothing sounds on the way down.
  const released = await page.waitForFunction(
    () => {
      const r = window.__alarmStage!.read();
      return r.active ? null : r;
    },
    undefined,
    { timeout: 30_000, polling: 100 },
  );
  const afterRelease = (await released.jsonValue()) as AlarmReading;
  expect(afterRelease.sounds, 'the release is silent — a sting announces, it does not sign off').toBe(1);

  // --- PHASE C. THE OWNERSHIP CLAIM. Five seconds of fire on a RIVAL's core. -
  // "and should only play for your station not others". Same siege, same seam,
  // same duration — the only thing changed is whose home it is.
  const theirs = await siege(page, other!, SIEGE_MS);
  expect(theirs.hits, "the rival's core took a real siege too").toBeGreaterThan(30);
  expect(theirs.hpEnd!, "and really lost HP, so this is silence and not a no-op").toBeLessThan(
    theirs.hpStart!,
  );
  expect(theirs.maxSounds, "another station's siege never rings your klaxon").toBe(1);
  expect(theirs.maxEngagements, 'and never even raises an engagement on your side').toBe(1);
  expect(theirs.everActive, "your alarm stays down while someone else's home burns").toBe(false);

  // --- PHASE D. Re-engage. The guard is a guard, not a mute. ----------------
  // A one-shot that could only ever fire once a match would be a worse bug than
  // the loop. Fire on your own home again, after a real release, and it announces
  // again — which is exactly what the hysteresis is for.
  const again = await siege(page, me, SIEGE_MS);
  expect(again.everActive, 'a fresh assault raises the alarm again').toBe(true);
  expect(again.end.engagements, 'a second engagement').toBe(2);
  expect(again.end.sounds, 'and a second sting — once per engagement, not once per match').toBe(2);

  const readout = {
    what: 's9-01 — the alarm announces ONCE per engagement, and only for your own station',
    developer:
      'also for the alarm, it should only play once, and not keep playing (and should only play for your station not others)...',
    boot: '?debug=1 offline match, real preview bundle',
    listener: { local: me, allies: base.allies },
    phases: {
      'A: 5s siege on YOUR core': {
        frames: mine.frames,
        hits: mine.hits,
        coreHp: [mine.hpStart, mine.hpEnd],
        alarmRaised: mine.everActive,
        engagements: mine.end.engagements,
        soundsPeak: mine.maxSounds,
      },
      'B: released, unshot': { sounds: afterRelease.sounds, active: afterRelease.active },
      [`C: 5s siege on player ${other}'s core`]: {
        frames: theirs.frames,
        hits: theirs.hits,
        coreHp: [theirs.hpStart, theirs.hpEnd],
        alarmRaised: theirs.everActive,
        engagements: theirs.maxEngagements,
        soundsPeak: theirs.maxSounds,
      },
      'D: 5s siege on YOUR core again': {
        alarmRaised: again.everActive,
        engagements: again.end.engagements,
        sounds: again.end.sounds,
      },
    },
  };
  // eslint-disable-next-line no-console -- captioned readout for the PR evidence.
  console.log('[alarm-once]', JSON.stringify(readout));
  writeFileSync(EVIDENCE, `${JSON.stringify(readout, null, 2)}\n`);

  expect(pageErrors, `no page errors while sieging: ${pageErrors.join('\n')}`).toEqual([]);
});
