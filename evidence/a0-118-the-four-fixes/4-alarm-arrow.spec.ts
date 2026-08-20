/**
 * evidence/a0-118-the-four-fixes/4-alarm-arrow.spec.ts — the red arrow and the
 * wave clock. OWNER: QA Manager (a0-118).
 *
 * a0-111's verdict, in its own words: *"At this bearing it lands on the top edge,
 * in the middle - which is where the wave clock is. At 3x the red arrow is drawn
 * on top of the clock's first line: it covers the A of WAVE and most of the V."*
 * a0-116 was briefed off that frame. **a0-116 merged while this bench was being
 * built** — PR #493, `origin/main` @ `e498b831` — so the bundle under this camera
 * DOES carry the fix, and this spec is a test of it. An earlier draft of this file
 * was written when #493 was still open and said the opposite; the branch was
 * re-baselined onto `e498b831` and every frame in this run was re-taken against
 * that build, so no frame here predates the fix.
 *
 * ── WHY THIS IS A SWEEP AND NOT ONE FRAME ───────────────────────────────────
 * The arrow rides the screen edge at the bearing of the off-screen station, so
 * whether it lands on the wave clock is a fact about where the ship is standing.
 * a0-111 photographed one bearing — `__oreHudStage.mine(0)`, the shipped seam,
 * which parks the ship at station + (900, 900) — and got the top edge, middle.
 * That frame is reproduced FIRST, unchanged, because it is the specimen the brief
 * was written from. Then the ship is flown around it with REAL taps and the
 * arrow's own registry rect is recorded at every stop, so the note can say which
 * bearings put the arrow at the top-centre rather than assert that one does.
 *
 * The siege is HELD with a pump, a0-104's shape kept through a0-111: the alarm
 * latches for 5 s and drains at 2 HP/s, and a dpr-2 screenshot plus its round
 * trips take longer than that, so a burst of damage followed by a leisurely
 * capture photographs a RELEASED alarm — and worse, the UNDER-ATTACK prompt
 * *completes* on a siege survived, retiring the very prompt this is about. 2 HP
 * every 400 ms through the sim's own damage function, with a floor, because a
 * dead station switches the alarm off and a siege is not a demolition.
 *
 * ── WHAT CANNOT BE MEASURED HERE, AND WHY ───────────────────────────────────
 * The wave clock is still NOT in the layout registry (`src/ui/hud.ts`
 * `describeLayout` argues the case: its `top-center` zone is a third of the
 * viewport and the strip is intrinsically wider). a0-115 added `wave-clock` to
 * `HUD_READOUT_IDS` so a nameplate must keep out of it, but that is a keep-out
 * list inside the HUD, not a registry row a harness can read. So there is no
 * rect-intersection number to print for this one the way there is for the ore
 * counter, and this spec does not invent one: it records the ARROW's rect, which
 * the registry does carry, photographs the frame, and the verdict is written off
 * a magnified crop of the top-centre by reading it. That is the honest instrument
 * for "is WAVE readable", and it is the same one a0-111 used.
 */
import { test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { PROFILES } from './profiles';
import { bootDebugMatch, layoutRows, origin, park } from './drive';
import { frame, note } from './shot';
import { settleFrames } from '../../tests/mobile/render-settle';

/** Below this the pump stops: a dead station switches the alarm off entirely. */
const FLOOR_HP = 30;
const MINE_OFFSET = { x: 900, y: 900 };

async function startSiege(page: Page): Promise<void> {
  await page.evaluate((floor) => {
    const w = window as unknown as { __a0118Pump?: number };
    if (w.__a0118Pump !== undefined) return;
    w.__a0118Pump = window.setInterval(() => {
      const hp = window.__planetRush?.coreHp?.(0) ?? null;
      if (hp !== null && hp > floor) window.__planetRush?.damageCore?.(0, 2);
    }, 400);
  }, FLOOR_HP);
}

async function stopSiege(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __a0118Pump?: number };
    if (w.__a0118Pump !== undefined) window.clearInterval(w.__a0118Pump);
    w.__a0118Pump = undefined;
  });
}

/** Wait until the HUD itself says the alarm is up — `alarm-frame` in the layout
 *  registry, the pulsing screen frame the arrow keys off. */
async function waitForAlarm(page: Page): Promise<number> {
  for (let i = 0; i < 40; i++) {
    const rows = await layoutRows(page);
    if (rows.some((r) => r.id === 'alarm-frame')) return i;
    await page.waitForTimeout(300);
  }
  return -1;
}

/** Everything about this frame that bears on "is the arrow on the clock". */
async function readback(page: Page, profileWidth: number): Promise<Record<string, unknown>> {
  const rows = await layoutRows(page);
  const arrow = rows.find((r) => r.id === 'alarm-arrow')?.bounds ?? null;
  const state = await page.evaluate(() => ({
    prompt: window.__onboardingStage?.prompt() ?? null,
    world: window.__viewStage?.world() ?? null,
    viewport: window.__viewStage?.viewport() ?? null,
    coreHp: window.__planetRush?.coreHp?.(0) ?? null,
    ship: window.__pauseStage?.read().ship ?? null,
  }));
  return {
    ...state,
    arrowDrawn: arrow !== null,
    arrowRect: arrow,
    // Where the arrow's centre stands, in the two terms that decide whether it
    // is on the wave clock: how far from the top edge, and how far from the
    // horizontal centre of the glass (the clock is top-centre).
    arrowCentre: arrow ? { x: arrow.x + arrow.width / 2, y: arrow.y + arrow.height / 2 } : null,
    arrowDistanceFromHorizontalCentre: arrow
      ? Math.round(Math.abs(arrow.x + arrow.width / 2 - profileWidth / 2) * 10) / 10
      : null,
    alarmFrameDrawn: rows.some((r) => r.id === 'alarm-frame'),
    promptDrawn: rows.some((r) => r.id === 'onboarding'),
    elements: rows.map((r) => r.id),
  };
}

for (const profile of PROFILES) {
  test(`a0-118 the alarm arrow and the wave clock — ${profile.id}`, async ({ browser }) => {
    test.setTimeout(300_000);
    const context = await browser.newContext({
      viewport: { width: profile.width, height: profile.height },
      deviceScaleFactor: profile.dpr,
      isMobile: profile.touch,
      hasTouch: profile.touch,
    });
    const page = await context.newPage();
    await bootDebugMatch(page);

    // a0-111's staging, verbatim: home OFF screen via the shipped seam, which
    // parks the ship at station + (900, 900).
    await page.evaluate(() => window.__oreHudStage?.mine(0));
    await settleFrames(page, 8);
    await startSiege(page);
    const polls = await waitForAlarm(page);
    // Re-park: the ship drifts while the siege is being established, and the
    // whole question is where HOME is relative to the glass at the photograph.
    await page.evaluate(() => window.__oreHudStage?.mine(0));
    await settleFrames(page, 8);
    await park(page);

    const baseName = `${profile.id}-arrow-0-a0111-bearing`;
    await frame(page, baseName);
    const baseRead = await readback(page, profile.width);

    // Now fly it. Eight real taps around the glass, the arrow's rect recorded at
    // each, so the note can name the bearings that put it at the top-centre
    // instead of asserting that a0-111's does.
    const o = await origin(page);
    const sweep: unknown[] = [];
    const headings = [
      [0.1, 0.5],
      [0.5, 0.9],
      [0.9, 0.5],
      [0.5, 0.1],
      [0.15, 0.85],
      [0.85, 0.85],
      [0.85, 0.15],
      [0.15, 0.15],
    ] as const;
    for (let i = 0; i < headings.length; i++) {
      const [fx, fy] = headings[i]!;
      const px = o.x + profile.width * fx;
      const py = o.y + profile.height * fy;
      if (profile.touch) await page.touchscreen.tap(px, py);
      else await page.mouse.click(px, py);
      await page.waitForTimeout(1_600);
      await park(page);
      const name = `${profile.id}-arrow-sweep-${i}`;
      await frame(page, name);
      const read = await readback(page, profile.width);
      sweep.push({ stop: i, tappedAt: { x: px, y: py }, shot: `${name}.png`, ...read });
    }
    await stopSiege(page);

    // The stop whose arrow stands nearest the horizontal centre of the top edge —
    // the bearing the brief names, chosen by measurement rather than by taste.
    const withArrow = [{ stop: -1, shot: `${baseName}.png`, ...baseRead }, ...sweep].filter(
      (s) => (s as { arrowRect: unknown }).arrowRect !== null,
    ) as { stop: number; shot: string; arrowRect: { y: number }; arrowDistanceFromHorizontalCentre: number }[];
    const topmost = withArrow.filter((s) => s.arrowRect.y < profile.height * 0.35);
    const nearestTopCentre =
      (topmost.length > 0 ? topmost : withArrow).slice().sort(
        (a, b) => a.arrowDistanceFromHorizontalCentre - b.arrowDistanceFromHorizontalCentre,
      )[0] ?? null;

    note(`${profile.id}-alarm-arrow`, {
      profile: profile.label,
      boot: '?debug=1 on the production bundle (no ?freeze — the build stamp is in frame)',
      capturedAgainst:
        'origin/main @ e498b831, which INCLUDES a0-116 (PR #493, merged). This is a test of that fix: the arrow-vs-clock frames here were all taken against a bundle built from e498b831.',
      staging: `__oreHudStage.mine(0) — the local station left standing and the ship parked at station + (${MINE_OFFSET.x}, ${MINE_OFFSET.y}), so home is off screen; plus a held siege: __planetRush.damageCore(0, 2) every 400ms above a ${FLOOR_HP} HP floor`,
      alarmPolls: polls,
      waveClockInTheRegistry: false,
      waveClockNote:
        "src/ui/hud.ts describeLayout still does not register `wave-clock` (its top-center zone is a third of the viewport and the strip is wider). a0-115 added it to HUD_READOUT_IDS as a nameplate keep-out, which is a rule inside the HUD, not a rect a harness can read. So there is no intersection number for this element and this note does not invent one — the verdict is read off the magnified crop.",
      a0111Bearing: { shot: `${baseName}.png`, ...baseRead },
      nearestTopCentre,
      sweep,
    });
    await context.close();
  });
}
