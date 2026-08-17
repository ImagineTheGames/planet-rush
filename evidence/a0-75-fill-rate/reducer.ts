/**
 * evidence/a0-75-fill-rate/reducer.ts — is `VfxAutoQuality` engaging on the
 * developer's machine, is it thrashing, and should it read the viewport?
 * OWNER: Art Agent (a0-75), asking about `src/platform/vfx-quality.ts`
 * (Platform Engineer's).
 *
 * The brief puts three questions to the auto-reducer and this file answers them
 * by driving the shipped state machine with frame times rather than by reading
 * its source and forming an opinion:
 *
 *   npx vite-node evidence/a0-75-fill-rate/reducer.ts
 */
import { writeFileSync } from 'node:fs';
import { VfxAutoQuality, DEFAULT_VFX_QUALITY } from '../../src/platform/vfx-quality';

const lines: string[] = [];
const say = (s = ''): void => {
  lines.push(s);
  console.log(s);
};

/** Feed `seconds` of play at a steady frame rate; report the flag afterwards. */
function steady(fps: number, seconds: number): { engaged: boolean; flips: number; smoothed: number | null } {
  const q = new VfxAutoQuality();
  const dt = 1 / fps;
  let flips = 0;
  let last = false;
  for (let t = 0; t < seconds; t += dt) {
    const now = q.sample(dt);
    if (now !== last) flips++;
    last = now;
  }
  return { engaged: q.reduced, flips, smoothed: q.smoothedFps };
}

/** Feed a rate that wanders around a centre — the real shape of a stutter, and
 *  the input a thermostat can be made to chatter on. */
function wobble(centre: number, swing: number, seconds: number, periodSeconds: number) {
  const q = new VfxAutoQuality();
  let t = 0;
  let flips = 0;
  let last = false;
  let engagedSeconds = 0;
  while (t < seconds) {
    const fps = centre + swing * Math.sin((2 * Math.PI * t) / periodSeconds);
    const dt = 1 / Math.max(1, fps);
    const now = q.sample(dt);
    if (now !== last) flips++;
    if (now) engagedSeconds += dt;
    last = now;
    t += dt;
  }
  return { engaged: q.reduced, flips, engagedFraction: engagedSeconds / seconds };
}

say('a0-75 — VfxAutoQuality, driven rather than read');
say('='.repeat(74));
say();
say(`config: engage ≤ ${DEFAULT_VFX_QUALITY.engageFps} fps sustained ${DEFAULT_VFX_QUALITY.engageSustainSeconds}s ·`);
say(`        release ≥ ${DEFAULT_VFX_QUALITY.releaseFps} fps sustained ${DEFAULT_VFX_QUALITY.releaseSustainSeconds}s ·`);
say(`        EMA smoothing ${DEFAULT_VFX_QUALITY.smoothing}`);
say();

say('1. DOES IT ENGAGE? — 30 s of steady play at each rate');
say();
say(`${'fps'.padStart(6)}${'frame ms'.padStart(11)}${'engaged'.padStart(10)}${'flips'.padStart(8)}   verdict`);
const engageRows: Record<string, unknown>[] = [];
for (const fps of [12, 20, 25, 28, 29, 30, 31, 33, 36, 40, 45, 50, 55, 60]) {
  const r = steady(fps, 30);
  const verdict = r.engaged
    ? 'sheds VFX'
    : fps < 55
      ? 'CHOPPY AND UNTOUCHED'
      : 'fine, nothing to do';
  say(
    `${fps.toString().padStart(6)}${(1000 / fps).toFixed(1).padStart(11)}${(r.engaged ? 'yes' : 'no').padStart(10)}${String(r.flips).padStart(8)}   ${verdict}`,
  );
  engageRows.push({ fps, engaged: r.engaged, flips: r.flips });
}
say();
say('The floor is 30 fps, so everything from 31 to 54 is a frame rate the player');
say('feels — on a 60 Hz panel a 40 fps frame judders every third refresh — and');
say('the reducer never fires at all. It is not broken; it is answering a');
say('different question than the one a0-75 asks.');
say();

say('2. DOES IT THRASH? — 60 s wandering ±8 fps around each centre, 4 s period');
say();
say(`${'centre'.padStart(7)}${'flips/60s'.padStart(11)}${'engaged'.padStart(10)}   `);
const wobbleRows: Record<string, unknown>[] = [];
for (const centre of [22, 26, 30, 34, 40, 48]) {
  const r = wobble(centre, 8, 60, 4);
  say(
    `${centre.toString().padStart(7)}${String(r.flips).padStart(11)}${`${(r.engagedFraction * 100).toFixed(0)}%`.padStart(10)}`,
  );
  wobbleRows.push({ centre, flips: r.flips, engagedFraction: r.engagedFraction });
}
say();
say('No chatter anywhere — but look at the middle of that column rather than the');
say('ends. The failure it has is the OPPOSITE of thrash: a rate wandering ±8 fps');
say('around 26 never engages at all, because any excursion above the floor resets');
say('`bandSeconds` to zero and a 4 s wobble crosses 30 twice a cycle. So it fires');
say('on a steady slog and not on a stutter, and a stutter is what a stutter is.');
say('That is a real observation about the shipped state machine and it is NOT');
say('a0-75\'s to fix: the fix here removes the cost, so nothing has to detect it.');
say();

say('3. SHOULD IT READ THE VIEWPORT? — no, and the reason is what it can reach');
say();
say('  What the flag actually sheds (main.ts:2570 and its callees):');
say('    · vfxField.quality      — particle budget per burst (thins, never drops)');
say('    · renderer.setReduceVfx — impact glows, spawn shimmer, station halo');
say('    · VoidBackdrop          — NOTHING mid-match. r9-01 pins the sky density');
say('                              at build on purpose, so a device that throttles');
say('                              at t+8s keeps the sky it booted with.');
say();
say('  Every one of those is per-ENTITY. None of them is per-PIXEL, and a0-75 is');
say('  a per-pixel cost: the backdrop was blending 5.40 screenfuls a frame at');
say('  3440×1440 and 7.39 at 32:9. Wiring viewport area into this state machine');
say('  would have shed sparks on a big window while the sky went on being paid');
say('  for in full — a reducer reacting to the right signal with the wrong lever.');
say();
say('  And after the fix there is nothing left for an area input to react to.');
say('  Backdrop fill is now 2.33 screenfuls at EVERY viewport in the sweep and on');
say('  every map (src/art/backdrop-fill.test.ts). The honest fix for a cost that');
say('  scaled with area was to stop it scaling, not to detect that it had.');
say();
say('  One thing worth handing to the Platform Engineer, since it is their file:');
say('  `sample()` discards any frame over 1 s (vfx-quality.ts:90) as a tab thaw.');
say('  That is right for a thaw and it means a genuinely 2 s frame — which is what');
say('  the container measures at 5120×1440 — is invisible to the reducer, so a');
say('  machine slow enough to need it most is the one it never sees. Not changed');
say('  here: it is a deliberate spike guard and moving it is theirs to weigh.');

writeFileSync(new URL('./reducer.txt', import.meta.url), `${lines.join('\n')}\n`);
writeFileSync(
  new URL('./reducer.json', import.meta.url),
  `${JSON.stringify({ config: DEFAULT_VFX_QUALITY, engageRows, wobbleRows }, null, 2)}\n`,
);
