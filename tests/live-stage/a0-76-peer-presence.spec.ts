/**
 * tests/live-stage/a0-76-peer-presence.spec.ts — the drop tell, DRAWN, on the
 * REAL booted bundle. OWNER: UI Engineer (a0-76).
 *
 * The developer: *"do we have any indication when a player loses connection (like
 * for the other players that remained in match…) and when they join back as
 * well… we need something to indicate that so other players know"*.
 *
 * ## What only a boot can prove
 *
 * `src/ui/hud.test.ts` proves the model turns authority's own broadcasts into the
 * right lines, and `presenceBand` proves where the band lands at every viewport.
 * Neither can prove the shipped bundle puts a pixel on the screen: the leg from
 * `HudFrame.presence` → `PeerPresenceView.update` → a drawn `Text` is exactly the
 * wiring that has shipped dead in this codebase before — a merged feature nothing
 * ever called (the M2 dark-matter class; `installLinkLossView` appeared exactly
 * once in `src/`, at its own definition, for the whole life of the feature).
 *
 * So this drives `window.__presenceStage`, which feeds REAL `ServerMessage` values
 * through `applyPresenceMessage` — the same function the online session's observer
 * calls, not a shortcut past it — and reads back the rows the VIEW actually drew,
 * post-cull, with their text, their colour and their screen position.
 *
 * `?debug=1` boots offline, where nothing can drop and no banner could ever
 * appear on its own; that is precisely why the broadcasts are injected. The
 * two-client version of the same sequence, over a real fleet, is
 * `evidence/a0-76-peer-presence/presence-probe.ts`.
 */
import { test, expect, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';

/** One drawn row as `PeerPresenceView.debugLines()` reports it. */
interface DrawnLine {
  seat: number;
  text: string;
  name: string;
  reason: string;
  clause: string;
  clauseDropped: boolean;
  color: number;
  alpha: number;
  x: number;
  y: number;
  width: number;
}
interface PresenceStage {
  drop(seat: number, held?: boolean): void;
  back(seat: number): void;
  bots(isBot: readonly boolean[]): void;
  reset(): void;
  drawn(): DrawnLine[];
  lines(): { text: string; seat: number; state: string }[];
}
/** The nameplate seam next door — used here only to prove the banner spells a
 *  seat with the SAME table the plate over its hull reads (`resolveName`). */
interface NameplateStage {
  names(): Array<string | undefined>;
}
declare const window: Window & {
  __presenceStage?: PresenceStage;
  __nameplateStage?: NameplateStage;
};

const DESKTOP = { width: 1280, height: 720 } as const;
/** The landscape phone the layout briefs measure at: 844×390. */
const PHONE_LANDSCAPE = { width: 844, height: 390 } as const;
const OUT = 'evidence/a0-76-peer-presence';

/** Frames, not milliseconds — the honest unit on a software-GL runner. */
async function frames(page: Page, n = 8): Promise<void> {
  await page.evaluate(
    (count) =>
      new Promise<void>((resolve) => {
        let left = count;
        const step = (): void => {
          if (left-- <= 0) resolve();
          else requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      }),
    n,
  );
}

/** Boot the frozen client at a given size with the presence seam available. */
async function boot(page: Page, size: { width: number; height: number }): Promise<void> {
  await page.setViewportSize({ width: size.width, height: size.height });
  await page.goto('/?debug=1&freeze=1', { waitUntil: 'load' });
  await page.waitForSelector('canvas', { state: 'attached', timeout: 30_000 });
  await page.waitForFunction(() => typeof window.__presenceStage?.drop === 'function', undefined, {
    timeout: 20_000,
  });
  await frames(page);
}

test.describe('the drop tell reaches the screen (a0-76)', () => {
  test('a peer who drops is DRAWN, named, and drawn again when they return', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (e) => pageErrors.push(String(e)));
    mkdirSync(OUT, { recursive: true });
    await boot(page, DESKTOP);

    // Nothing has happened: the banner draws nothing at all. This is the guard on
    // its own value — a permanent readout of a match's healthy seats would be a
    // region of screen spent saying "nothing happened".
    expect(await page.evaluate(() => window.__presenceStage!.drawn())).toEqual([]);

    // ── THE DROP ────────────────────────────────────────────────────────────
    // Authority's own words: seat 2's socket went away, a bot has the controls,
    // and the seat is held for its operator for as long as the match runs.
    await page.evaluate(() => {
      window.__presenceStage!.drop(2, true);
      window.__presenceStage!.bots([false, false, true, false]);
    });
    await frames(page);

    const dropped = await page.evaluate(() => window.__presenceStage!.drawn());
    expect(dropped, 'the drop is on the screen, not merely in the model').toHaveLength(1);
    // NAMED — and named with the SAME table the nameplate over that hull reads,
    // which is the whole point of routing the banner through `resolveName`. On
    // this offline boot seat 2 is a seated bot character, so the client's own
    // name table is the assertion rather than a string this test invented; a seat
    // with no name at all would read the `P{n}` identity tag instead.
    const seatName = await page.evaluate(() => window.__nameplateStage!.names()[2]);
    expect(seatName, 'seat 2 has a name in the booted client').toBeTruthy();
    expect(dropped[0]!.name).toBe(seatName);
    expect(dropped[0]!.text).toBe(`${seatName} — CONNECTION LOST · BOT FLYING`);
    expect(dropped[0]!.reason).toBe('CONNECTION LOST');
    // …and the bot that took the seat, as a SECOND clause, so it never displaces
    // the name a player is scanning for.
    expect(dropped[0]!.clause).toBe('BOT FLYING');
    expect(dropped[0]!.clauseDropped).toBe(false);
    expect(dropped[0]!.seat).toBe(2);
    expect(dropped[0]!.alpha).toBe(1);
    // The name wears seat 2's identity colour (style-guide §3.1 — P3 Spring), the
    // same hue as its ship trim and its nameplate, so the line ties to a ship the
    // player can see rather than to an index they cannot.
    expect(dropped[0]!.color).toBe(0x3dd68c);
    // Drawn under the wave clock, top centre, inside the HUD margin.
    expect(dropped[0]!.y).toBeGreaterThan(40);
    expect(dropped[0]!.y).toBeLessThan(DESKTOP.height / 3);
    expect(dropped[0]!.x).toBeGreaterThan(16);
    expect(dropped[0]!.x + dropped[0]!.width).toBeLessThan(DESKTOP.width - 16);
    // Centred on the clock's column, within a pixel of the screen's own middle.
    expect(dropped[0]!.x + dropped[0]!.width / 2).toBeCloseTo(DESKTOP.width / 2, 0);
    await page.screenshot({ path: `${OUT}/drawn-dropped-desktop.png` });

    // ── THE RETURN ──────────────────────────────────────────────────────────
    await page.evaluate(() => {
      window.__presenceStage!.back(2);
      window.__presenceStage!.bots([false, false, false, false]);
    });
    await frames(page);

    const back = await page.evaluate(() => window.__presenceStage!.drawn());
    expect(back, 'the return is drawn too — a silent return is as confusing as a silent drop').toHaveLength(1);
    // Named AGAIN, and by the same name: a player who read the drop half a minute
    // ago does not have to work out that "seat 2" is the same person.
    expect(back[0]!.name).toBe(seatName);
    expect(back[0]!.text).toBe(`${seatName} — BACK · BOT OUT`);
    expect(back[0]!.color).toBe(0x3dd68c);
    await page.screenshot({ path: `${OUT}/drawn-back-desktop.png` });

    expect(pageErrors, 'the booted client threw nothing').toEqual([]);
  });

  test('an abandon reads differently from a drop, and both draw', async ({ page }) => {
    await boot(page, DESKTOP);
    await page.evaluate(() => {
      window.__presenceStage!.drop(1, true); // held — they may be back
      window.__presenceStage!.drop(3, false); // no hold — they pressed ABANDON
    });
    await frames(page);

    const rows = await page.evaluate(() => window.__presenceStage!.drawn());
    const names = await page.evaluate(() => window.__nameplateStage!.names());
    const tail = (seat: number): string => rows.find((r) => r.seat === seat)!.text.split(' — ')[1]!;
    // The SAME message type carries both, and `heldForMatch` is the whole
    // difference — so the two rows must not read alike.
    expect(tail(1)).toBe('CONNECTION LOST · BOT FLYING');
    expect(tail(3)).toBe('LEFT THE MATCH · BOT FLYING');
    for (const row of rows) expect(row.name).toBe(names[row.seat] ?? `P${row.seat + 1}`);
    // Stacked, not overlapping: the second row sits a full leading below the first.
    const ys = rows.map((r) => r.y).sort((a, b) => a - b);
    expect(ys[1]! - ys[0]!).toBeGreaterThan(8);
    await page.screenshot({ path: `${OUT}/drawn-two-rows-desktop.png` });
  });

  test('legible on a 844×390 phone, and inside the HUD margin', async ({ page }) => {
    mkdirSync(OUT, { recursive: true });
    await boot(page, PHONE_LANDSCAPE);
    await page.evaluate(() => {
      window.__presenceStage!.drop(2, true);
      window.__presenceStage!.bots([false, false, true, false]);
    });
    await frames(page);

    const rows = await page.evaluate(() => window.__presenceStage!.drawn());
    expect(rows, 'a phone gets the tell too — a phone is where the drops happen').toHaveLength(1);
    expect(rows[0]!.reason).toBe('CONNECTION LOST');
    expect(rows[0]!.name.length).toBeGreaterThan(0);
    // The whole row is inside the margin — which is what makes the layer's
    // `full` + PAD registration honest rather than hopeful.
    expect(rows[0]!.x).toBeGreaterThanOrEqual(16);
    expect(rows[0]!.x + rows[0]!.width).toBeLessThanOrEqual(PHONE_LANDSCAPE.width - 16);
    // …and it never reaches the bottom half, where the thumb controls and the
    // minimap live.
    expect(rows[0]!.y).toBeLessThan(PHONE_LANDSCAPE.height / 2);
    await page.screenshot({ path: `${OUT}/drawn-dropped-phone.png` });
  });
});
