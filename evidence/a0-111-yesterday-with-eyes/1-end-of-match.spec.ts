/**
 * evidence/a0-111-yesterday-with-eyes/1-end-of-match.spec.ts — the screen a match
 * ends on, all four faces of it. OWNER: QA Manager (a0-111).
 *
 * a0-108 replaced the fiction words with plain ones: the headlines are now
 * `VICTORY` / `DEFEAT` / `DRAW` / `ELIMINATED`. The clause that change was allowed
 * under is GDD §4.7's — the summary must still say WHO WON — and the guard on it
 * was rewritten rather than deleted. So this photographs each of the four and
 * reads the line under the headline back word for word. A subhead that no longer
 * names who won is a failed verdict, and it is the finding.
 *
 * Four boots per profile, because a match ends once. Each is the production
 * bundle under `?debug=1` (no `?freeze=1` — the build stamp has to be in frame),
 * and each ending is staged through the sim's OWN paths on the `__endScreenStage`
 * seam (`src/main.ts` `installEndScreenStage`), never by writing a headline:
 *
 *   VICTORY     `winLocal()`        — every rival core falls, the local one stands.
 *   DEFEAT      `endMatch()`        — every core but one rival's falls, including ours.
 *   ELIMINATED  `eliminateLocal()`  — our core falls, the others fight on.
 *   DRAW        no seam exists      — so it is staged the only way the debug boot
 *                                     can: `__planetRush.damageCore` on every seat
 *                                     until nothing is standing, which is the
 *                                     `winner === null` case `endKind` reads as a
 *                                     draw. If it will not stage, this spec says so
 *                                     and the frame is missing rather than faked.
 *
 * The result screen runs a count-up sequence before it settles (pr-05), so each
 * capture skips it the way an input does (`summarySkip()`) and waits for the
 * sequence's own `done` before photographing. Nothing about the summary's WORDS
 * is staged.
 */
import { test } from '@playwright/test';
import { PROFILES } from './profiles';
import { bootDebugMatch, layoutRows, park } from './drive';
import { frame, note } from './shot';
import { recordWords, drawnWords, hits } from './words';

type Outcome = 'victory' | 'defeat' | 'eliminated' | 'draw';

/** Stage one ending through the sim's own paths. Returns what it did, in words,
 *  so the readback can state the staging rather than imply it. */
async function stage(page: import('@playwright/test').Page, kind: Outcome): Promise<string> {
  if (kind === 'victory') {
    await page.evaluate(() => window.__endScreenStage!.winLocal());
    return "__endScreenStage.winLocal() — every rival core destroyed through the sim's own destroyCore; the local core stands";
  }
  if (kind === 'defeat') {
    await page.evaluate(() => window.__endScreenStage!.endMatch());
    return "__endScreenStage.endMatch() — every core but one rival's destroyed, including the local one";
  }
  if (kind === 'eliminated') {
    await page.evaluate(() => window.__endScreenStage!.eliminateLocal());
    return "__endScreenStage.eliminateLocal() — the local core destroyed through the sim's own destroyCore; the others fight on";
  }
  // DRAW has no seam, and it cannot be staged in waves: `destroyCore` resolves
  // the match as soon as ONE core is left, so killing seats a few at a time
  // crowns whoever happened to fall last and produces a DEFEAT. (That is not a
  // defect — it is the sim being right about a match that was already over. The
  // first cut of this spec did exactly that and photographed `DEFEAT / Player 8
  // won.` over eight dead reactors; the finding was in the harness.)
  //
  // A real draw is the simultaneous case, so this queues one lethal write per
  // seat in a SINGLE call. The debug queue is drained FIFO inside one tick
  // (`src/main.ts`: `debugStage.drain()` immediately after the authoritative
  // step), so all eight cores fall on the same tick and the next step resolves a
  // match with no survivor at all — `winner === null`, which `endKind` reads as
  // a draw.
  // The burst is RETRIED, all eight seats together each time, because a fresh
  // world holds `station.spawnProtect` up for the opening seconds and
  // `damageStation` refuses every point of damage while it is
  // (`src/sim/buildings.ts`). A single early burst lands nothing at all — the
  // second cut of this spec fired one 800 ms after boot and photographed eight
  // untouched reactors. Retrying keeps every attempt simultaneous, so the first
  // one that gets through is the one that kills all eight on one tick.
  let landed = false;
  for (let attempt = 0; attempt < 30 && !landed; attempt++) {
    await page.evaluate(() => {
      for (let p = 0; p < 8; p++) window.__planetRush!.damageCore?.(p, 999);
    });
    await page.waitForTimeout(500);
    landed = await page.evaluate(() =>
      Array.from({ length: 8 }, (_, p) => window.__planetRush!.coreHp?.(p) ?? 0).every((hp) => hp <= 0),
    );
  }
  await page.waitForTimeout(1_200);
  return 'one lethal __planetRush.damageCore(p, 999) queued for all eight seats in a SINGLE call — retried together until spawn protection lapsed and it landed — so every core fell on the same tick (there is no draw seam)';
}

/** Wait for an end screen, skip the count-up sequence, wait for it to settle. */
async function settleEndScreen(page: import('@playwright/test').Page): Promise<string> {
  await page
    .waitForFunction(() => window.__endScreenStage!.screen() !== 'none', undefined, { timeout: 30_000 })
    .catch(() => undefined);
  const screen = await page.evaluate(() => window.__endScreenStage!.screen());
  if (screen === 'none') return screen;
  // Skip the summary exactly as an input does, then wait for the sequence's own
  // `done` — a frame taken mid-count is a frame of a different screen.
  await page.evaluate(() => window.__endScreenStage!.summarySkip());
  await page
    .waitForFunction(() => (window.__endScreenStage!.summary()?.done ?? true) === true, undefined, { timeout: 20_000 })
    .catch(() => undefined);
  await park(page);
  return screen;
}

const OUTCOMES: readonly Outcome[] = ['victory', 'defeat', 'draw', 'eliminated'];

for (const profile of PROFILES) {
  for (const kind of OUTCOMES) {
    test(`a0-111 end of match — ${kind} — ${profile.id}`, async ({ browser }) => {
      test.setTimeout(300_000);
      const context = await browser.newContext({
        viewport: { width: profile.width, height: profile.height },
        deviceScaleFactor: profile.dpr,
        isMobile: profile.touch,
        hasTouch: profile.touch,
      });
      const page = await context.newPage();
      await recordWords(page);
      await bootDebugMatch(page);
      await page.waitForTimeout(800);

      const staging = await stage(page, kind);
      const screen = await settleEndScreen(page);
      const name = `${profile.id}-end-${kind}`;
      await frame(page, name);

      const read = await page.evaluate(() => ({
        screen: window.__endScreenStage!.screen(),
        result: window.__endScreenStage!.result(),
        buttons: window.__endScreenStage!.buttons(),
        cores: Array.from({ length: 8 }, (_, p) => window.__planetRush!.coreHp?.(p) ?? null),
      }));
      const words = await drawnWords(page);

      note(name, {
        profile: profile.label,
        boot: '?debug=1 on the production bundle (no ?freeze — the build stamp is in frame)',
        asked: kind,
        staging,
        screenReported: screen,
        result: read.result,
        buttons: read.buttons,
        coreHp: read.cores,
        elements: (await layoutRows(page)).map((r) => r.id),
        // The two questions the brief asks of this screen, answered off the
        // client's own strings rather than off the picture — the picture is what
        // the attestation is written from.
        subheadNamesAPlayer: /player\s*\d/i.test(read.result?.subhead ?? ''),
        subheadSaysWon: /\bwon\b|\bwin[s]?\b/i.test(read.result?.subhead ?? ''),
        drawnTextCount: { drawn: words.drawn.length, measured: words.measured.length },
        claimHits: hits(words, 'claim'),
      });
      await context.close();
    });
  }
}
