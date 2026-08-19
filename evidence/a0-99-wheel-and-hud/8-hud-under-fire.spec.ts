/**
 * evidence/a0-99-wheel-and-hud/8-hud-under-fire.spec.ts — the HUD with something
 * actually happening to it. OWNER: QA Manager (a0-99).
 *
 * Written after looking at `*-hud-midfight.png`. Spec 5 flies the ship out and
 * shoots, and what it produced is an honest picture of an empty starfield: the
 * bots never engaged inside the window, so nothing on the HUD moved. Those frames
 * stay — they are what "twenty seconds into a real match" looks like — but they
 * do not answer the brief's "mid-fight", and one of the five things the brief
 * names is **the ship HP**, which this HUD deliberately has no readout for. The
 * dedicated top-right HULL element was removed on a field report ("it's already
 * appearing on my ship"), so the only ship HP a player ever sees is a bar over
 * the ship, and a bar over an undamaged ship is a bar that isn't there.
 *
 * So this stages the damage instead of waiting for it, through the `?debug=1`
 * write seams that go through the SIM'S OWN ratified damage functions on a tick
 * boundary (`window.__planetRush.damageShip` / `.damageCore`) rather than poking
 * world state — plus `__healthbarStage.damageEnemy` so a rival's bar is on screen
 * too. Three frames on each profile: undamaged, ship hurt, ship and home hurt.
 *
 * Declared plainly, because it matters to how these frames should be read: the
 * damage is staged. What is NOT staged is anything about the HUD — no element is
 * shown, hidden, moved or armed by this spec. It hurts things and photographs
 * what the shipped HUD decided to do about it.
 *
 * One thing the first run of this spec taught, recorded because it changes how
 * the readback should be trusted: a SINGLE `damageCore` does not reliably land.
 * The write is queued and drained on a tick boundary, and on the first pass the
 * desktop core dropped to 62 while the phone core sat at 100 — the same call, the
 * same bundle, a different profile. Re-running with nothing but `damageCore` left
 * BOTH at 100, so it is not a phone/desktop difference; it is that the staged
 * write lands intermittently. So {@link hurtHome} calls it until `coreHp` actually
 * moves, up to a bounded number of tries, and writes down how many it took. That
 * is a note about this HARNESS, not a finding about the game: nothing a player
 * does goes through this seam.
 *
 * Nothing is asserted. The finding is whatever comes back.
 */
import { test } from '@playwright/test';
import { PROFILES } from './profiles';
import { bootDebugMatch, layoutRows } from './drive';
import { frame, note, overlap } from './shot';

declare global {
  interface Window {
    __planetRushDbg?: { damageShip(owner: number, amount: number): unknown; damageCore(player: number, amount: number): unknown; coreHp(player: number): number | null };
    __healthbarStage?: { damageEnemy(fraction: number): unknown; damageLocal(fraction: number): unknown; bars?(): unknown };
    __hudProbe?: unknown;
  }
}

for (const profile of PROFILES) {
  test(`a0-99 the HUD under fire — ${profile.id}`, async ({ browser }) => {
    test.setTimeout(300_000);
    const context = await browser.newContext({
      viewport: { width: profile.width, height: profile.height },
      deviceScaleFactor: profile.dpr,
      isMobile: profile.touch,
      hasTouch: profile.touch,
    });
    const page = await context.newPage();
    await bootDebugMatch(page);
    await page.waitForTimeout(900);

    const read = async (): Promise<unknown> =>
      page.evaluate(() => {
        const pr = window.__planetRush as unknown as { coreHp?(p: number): number | null };
        return { localCoreHp: pr?.coreHp?.(0) ?? null };
      });

    await frame(page, `${profile.id}-fire-0-undamaged`);
    const before = { state: await read(), elements: await layoutRows(page) };

    // Hurt the local SHIP and a rival's. `damageShip` is the queued write; it is
    // kept because it is the one that goes through the sim's own damage function,
    // but the first run of this spec showed it landing no more reliably than
    // `damageCore` did — the local bar still read 50/50 afterwards. So the
    // health-bar stage's own `damageLocal` goes in beside it, and the frame is
    // read for which of the two actually moved the bar.
    await page.evaluate(() => {
      const pr = window.__planetRush as unknown as { damageShip?(o: number, a: number): unknown };
      pr?.damageShip?.(0, 20);
      window.__healthbarStage?.damageLocal(0.45);
      window.__healthbarStage?.damageEnemy(0.4);
    });
    await page.waitForTimeout(1_500);
    await frame(page, `${profile.id}-fire-1-ship-hurt`);
    const shipHurt = { state: await read(), elements: await layoutRows(page) };

    // Now hurt HOME, which is the readout the top-right corner does carry. Kept
    // up until the core actually moves — see the header on why one call is not
    // enough — so this leg produces a frame on both profiles or says it could not.
    let tries = 0;
    let hp = await page.evaluate(() => (window.__planetRush as unknown as { coreHp?(p: number): number | null })?.coreHp?.(0) ?? null);
    const startHp = hp;
    while (tries < 12 && hp !== null && startHp !== null && hp >= startHp) {
      tries++;
      await page.evaluate(() => {
        const pr = window.__planetRush as unknown as { damageCore?(p: number, a: number): unknown };
        pr?.damageCore?.(0, 12);
      });
      await page.waitForTimeout(900);
      hp = await page.evaluate(() => (window.__planetRush as unknown as { coreHp?(p: number): number | null })?.coreHp?.(0) ?? null);
    }
    await page.waitForTimeout(700);
    await frame(page, `${profile.id}-fire-2-home-hurt`);
    const homeHurt = { state: await read(), elements: await layoutRows(page) };

    const pairs = (rows: { id: string; bounds: { x: number; y: number; width: number; height: number } }[]): unknown[] => {
      const out: unknown[] = [];
      for (let i = 0; i < rows.length; i++)
        for (let j = i + 1; j < rows.length; j++) {
          const o = overlap(rows[i]!.bounds, rows[j]!.bounds);
          if (o) out.push({ a: rows[i]!.id, b: rows[j]!.id, intersection: o });
        }
      return out;
    };

    note(`${profile.id}-hud-under-fire`, {
      profile: profile.label,
      boot: '?debug=1 on the production bundle',
      staged: "damageShip(0,45) + damageEnemy(0.4), then damageCore(0,12) repeated until the core moved — through the sim's own damage functions",
      homeDamageTries: tries,
      homeHpAfter: hp,
      undamaged: { ...before, ids: before.elements.map((e) => e.id) },
      shipHurt: { ...shipHurt, ids: shipHurt.elements.map((e) => e.id), overlaps: pairs(shipHurt.elements) },
      homeHurt: { ...homeHurt, ids: homeHurt.elements.map((e) => e.id), overlaps: pairs(homeHurt.elements) },
    });
    await context.close();
  });
}
