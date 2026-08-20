/**
 * evidence/a0-118-the-four-fixes/2-host-refusal.spec.ts — the refusal that covered
 * the door it was refusing. OWNER: QA Manager (a0-118).
 *
 * a0-111's verdict, in its own words: *"DOWNLOAD LOG covers the HOST plate: at 3x
 * the button is opaque and takes the top of the word HOST, leaving only the bottom
 * sliver of the four letters showing below its lower edge."* a0-114 was briefed
 * off that frame and merged (cbca11c8 / b6253e29, PR #490).
 *
 * SAME ROUTE, and a REAL REFUSAL rather than a staged one — the brief is explicit
 * about that, and it is the only version worth photographing: this box has no
 * allocator to reach, so a genuine press on the HOST door produces a genuine
 * failure. Nothing about the refusal panel is constructed here.
 *
 *   ?gate=0  →  __mainMenu.play()  →  the doors  →  press HOST at its own
 *   reported centre  →  wait for the failure to stop moving  →  photograph.
 *
 * TWO measurements, because "covered" and "unpressable" are different faults and
 * a0-111 found only the first:
 *
 *  1. **Who receives the press.** `document.elementFromPoint` at each door's OWN
 *     reported centre — a0-96's finding tool, the one that caught a pause DONE
 *     plate with a DOM button at the top of the stack over it. `isCanvas: true`
 *     means the press reaches the game. a0-111 got `canvas` on all five doors
 *     even while the plate was covered, so this number is expected to be
 *     unchanged; it is taken anyway, because a fix that made a door unpressable
 *     while uncovering it would be a worse bug than the one it replaced.
 *
 *  2. **What is drawn over what.** Every DOM element the refusal puts on the page,
 *     its rect from `getBoundingClientRect`, intersected against every door's own
 *     `physicalBounds`. This is the arithmetic behind the sentence a0-111 wrote
 *     off the picture, and it is the number that has to have gone to zero.
 *
 * The picture is still what the attestation is written from. These two are the
 * cross-check, and the day they disagree with the image, the image wins.
 */
import { test } from '@playwright/test';
import { PROFILES } from './profiles';
import { bootMenu, controlPoint, origin, park, pressAt } from './drive';
import { frame, note } from './shot';
import { drawnWords, fullStrings, hits } from './words';
import { recordWords } from './words';

for (const profile of PROFILES) {
  test(`a0-118 the refused HOST — ${profile.id}`, async ({ browser }) => {
    test.setTimeout(300_000);
    const context = await browser.newContext({
      viewport: { width: profile.width, height: profile.height },
      deviceScaleFactor: profile.dpr,
      isMobile: profile.touch,
      hasTouch: profile.touch,
    });
    const page = await context.newPage();
    await recordWords(page);
    await bootMenu(page);
    await page.evaluate(() => window.__mainMenu!.play());
    await page.waitForFunction(() => window.__onlineMenu?.visible === true, undefined, { timeout: 30_000 });
    await park(page);

    // The doors, BEFORE the press — so the attestation can say what the refusal
    // landed on rather than infer it.
    const doorsBefore = await page.evaluate(() =>
      (window.__onlineMenu?.doorControls ?? []).map((c) => ({
        door: c.kind,
        centre: { ...c.physicalCenter },
        bounds: c.physicalBounds ? { ...c.physicalBounds } : null,
      })),
    );
    await frame(page, `${profile.id}-host-0-doors-before`);

    const hostControl = await controlPoint(page, 'doors', 'create');
    let hostPressed: { x: number; y: number } | null = null;
    if (hostControl.point) {
      hostPressed = hostControl.point;
      await pressAt(page, hostControl.point, profile.touch);
      // A HOST press with no allocator to reach ends somewhere; wait for it to
      // stop moving rather than for a state this capture has decided on.
      await page.waitForTimeout(8_000);
      await park(page);
    }
    await frame(page, `${profile.id}-host-1-refused`);

    const o = await origin(page);
    const measured = await page.evaluate((canvasOrigin) => {
      const inter = (
        a: { x: number; y: number; width: number; height: number },
        b: { x: number; y: number; width: number; height: number },
      ): { x: number; y: number; width: number; height: number } | null => {
        const x = Math.max(a.x, b.x);
        const y = Math.max(a.y, b.y);
        const r = Math.min(a.x + a.width, b.x + b.width);
        const bot = Math.min(a.y + a.height, b.y + b.height);
        if (r <= x || bot <= y) return null;
        return { x, y, width: r - x, height: bot - y };
      };
      const doors = (window.__onlineMenu?.doorControls ?? []).map((c) => ({
        door: c.kind,
        centre: { ...c.physicalCenter },
        bounds: c.physicalBounds ? { ...c.physicalBounds } : null,
      }));

      // 1. Who receives a press at each door's own reported centre.
      const reach = doors.map((d) => {
        const el = document.elementFromPoint(
          d.centre.x + (canvasOrigin as { x: number; y: number }).x,
          d.centre.y + (canvasOrigin as { x: number; y: number }).y,
        );
        return {
          door: d.door,
          at: d.centre,
          receivedBy: el
            ? {
                tag: el.tagName.toLowerCase(),
                text: (el.textContent ?? '').trim().slice(0, 40),
                zIndex: getComputedStyle(el).zIndex,
                isCanvas: el.tagName.toLowerCase() === 'canvas',
              }
            : null,
        };
      });

      // 2. Every DOM element the refusal drew, and what door rect it lands in.
      //    Buttons and anything else that is not the canvas: the refusal panel is
      //    DOM over a canvas game, which is the whole mechanism of a0-111's
      //    finding.
      const co = canvasOrigin as { x: number; y: number };
      const domOverlays: unknown[] = [];
      for (const el of Array.from(document.body.querySelectorAll('*'))) {
        if (el.tagName.toLowerCase() === 'canvas') continue;
        const r = el.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) continue;
        const cs = getComputedStyle(el);
        if (cs.visibility === 'hidden' || cs.display === 'none' || cs.opacity === '0') continue;
        // In canvas-local physical space, the space doorControls report in.
        const rect = { x: r.left - co.x, y: r.top - co.y, width: r.width, height: r.height };
        const over = doors
          .filter((d) => d.bounds)
          .map((d) => ({ door: d.door, intersection: inter(rect, d.bounds!) }))
          .filter((h) => h.intersection !== null);
        domOverlays.push({
          tag: el.tagName.toLowerCase(),
          text: (el.textContent ?? '').trim().slice(0, 60),
          zIndex: cs.zIndex,
          rect,
          coversDoors: over,
        });
      }
      return {
        doors,
        reach,
        // Only the elements that actually land on a door — the answer, short.
        domElementsCoveringADoor: domOverlays.filter(
          (d) => (d as { coversDoors: unknown[] }).coversDoors.length > 0,
        ),
        domElementsDrawn: domOverlays.length,
        allDomOverlays: domOverlays,
        online: {
          screen: window.__onlineMenu?.screen ?? null,
          status: window.__onlineMenu?.status ?? null,
          error: window.__onlineMenu?.error ?? null,
          notice: window.__onlineMenu?.notice ?? null,
          messageBounds: window.__onlineMenu?.messageBounds ?? null,
        },
      };
    }, o);

    const words = await drawnWords(page);
    note(`${profile.id}-host-refusal`, {
      profile: profile.label,
      boot: '?gate=0 on the production bundle — the front door, walked (no ?freeze: the build stamp is in frame)',
      route: 'front door -> PLAY -> the doors -> a REAL press on HOST, with no allocator on this box to reach',
      pressedHostAt: hostPressed,
      doorsBeforeThePress: doorsBefore,
      ...measured,
      // a0-111's headline count, restated as one number so the two runs compare.
      doorsCoveredByADomElement: [
        ...new Set(
          (measured.domElementsCoveringADoor as { coversDoors: { door: string }[] }[]).flatMap((d) =>
            d.coversDoors.map((c) => c.door),
          ),
        ),
      ],
      doorsThatDoNotReceiveTheirOwnPress: (measured.reach as { door: string; receivedBy: { isCanvas: boolean } | null }[])
        .filter((r) => !r.receivedBy?.isCanvas)
        .map((r) => r.door),
      screenText: fullStrings(words),
      retryHits: hits(words, 'retry'),
      downloadHits: hits(words, 'download'),
    });
    await context.close();
  });
}
