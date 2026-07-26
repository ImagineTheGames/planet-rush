/**
 * tests/live-stage/map-picker.spec.ts — the MAP PICKER lives IN THE LOBBY now, and
 * the arena you pick there is the arena the sim builds. OWNER: UI Engineer (GDD
 * §2.1; map registry m8-01; picker m8-02; p2 field rule — the picker moved off the
 * PLAY flow into the one pre-match room).
 *
 * The picker's failure mode is the dark-matter class the M2 HUD and the M4 lobby
 * were retracted for: a screen that is model-green (its cards, its layout, its
 * selection all unit-tested in `src/ui/map-picker.test.ts`) but never actually
 * threads its choice into the world the sim builds. A headless unit test cannot
 * catch a missing *wire* from a card tap to `createWorld`; only booting the real
 * bundle, picking a map in the lobby, and reading the booted world's own planets
 * can.
 *
 * So this spec boots the production build at a **phone-landscape, touch** viewport
 * — the primary mobile layout (GDD §4.3), and the "reachable on phone profiles in
 * landscape" the brief asks for — and drives the whole front of a match through the
 * read-only `window.__mainMenu` / `__lobby` seams `main.ts` installs:
 *
 *   MAIN MENU → PLAY → LOBBY (four arena cards, octagon selected, diamond VETERAN)
 *   → pick an arena → RUSH! → the booted world's home planets ARE that map's
 *   registry layout, exactly.
 *
 * The last step is the one that matters: `worldPlanets` is read back off the
 * *actual* sim world `bootOfflineMatch` built, and compared to `expectedPlanets` —
 * the same registry the bundle ships — so a picker that looked right but booted the
 * default arena would fail here. Persistence across a reload is checked too
 * (localStorage, same seam as the fire mode). The sibling `lobby-flow.spec.ts`
 * proves the same lobby also carries the hull; this one hammers all four arenas.
 */
import { test, expect, type Page } from '@playwright/test';

/** The read-only clean-boot seams this spec drives. Mirror the objects `main.ts`
 *  installs in `openMainMenu` and `openLobby`; the arena picker's facts now live
 *  on `__lobby` (the picker moved into the lobby, p2). */
interface LobbySeam {
  visible: boolean;
  isTouch: boolean;
  selectedMapId: string;
  defaultMapId: string;
  veteranMapId: string;
  mapOrder: readonly string[];
  mapCards: readonly { x: number; y: number; width: number; height: number }[];
  logicalViewport: { width: number; height: number };
  expectedPlanets: Record<string, { x: number; y: number }[]>;
  worldMapId: string | null;
  worldPlanets: { x: number; y: number }[] | null;
  selectMap(index: number): void;
  rush(): void;
}
interface MainMenuSeam {
  play(): void;
}
interface StageWindow {
  __mainMenu?: MainMenuSeam;
  __lobby?: LobbySeam;
}
declare const window: Window & StageWindow;

// A phone held on its side — the primary mobile layout (GDD §4.3), and the device
// the brief names ("reachable on phone profiles in landscape — cards big enough
// for thumbs"). `hasTouch` lays the lobby (and its arena row) out at thumb scale.
test.use({
  viewport: { width: 844, height: 390 },
  hasTouch: true,
  isMobile: true,
  deviceScaleFactor: 2,
});

/** Open a CLEAN boot, press PLAY, and wait for the LOBBY (with its arena picker)
 *  to install its seam. */
async function openLobby(page: Page): Promise<void> {
  await page.goto('/', { waitUntil: 'load' });
  await page.waitForSelector('canvas', { state: 'attached', timeout: 30_000 });
  await page.waitForFunction(() => typeof window.__mainMenu?.play === 'function', undefined, {
    timeout: 20_000,
  });
  await page.evaluate(() => window.__mainMenu!.play());
  await page.waitForFunction(() => typeof window.__lobby?.selectMap === 'function', undefined, {
    timeout: 20_000,
  });
}

test('the lobby shows four arena cards — octagon selected, diamond VETERAN — thumb-sized in landscape', async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));

  await openLobby(page);

  const p = await page.evaluate(() => {
    const l = window.__lobby!;
    return {
      visible: l.visible,
      selectedMapId: l.selectedMapId,
      defaultMapId: l.defaultMapId,
      veteranMapId: l.veteranMapId,
      order: l.mapOrder,
      isTouch: l.isTouch,
      cards: l.mapCards,
      viewport: l.logicalViewport,
    };
  });

  expect(p.visible, 'the lobby is on screen after PLAY').toBe(true);
  // Four cards — the four ratified maps (GDD §2.1; registry m8-01).
  expect(p.order).toEqual(['octagon', 'compass', 'oval', 'diamond']);
  expect(p.cards, 'one rect per card').toHaveLength(4);
  // Octagon preselected; diamond is the VETERAN map.
  expect(p.selectedMapId, 'octagon preselected the first time out').toBe('octagon');
  expect(p.defaultMapId).toBe('octagon');
  expect(p.veteranMapId).toBe('diamond');
  // Thumb-sized and wholly inside the safe (landscape) viewport.
  expect(p.isTouch, 'a phone lays the lobby out at thumb scale').toBe(true);
  for (const card of p.cards) {
    expect(card.width, 'card is a thumb target wide').toBeGreaterThanOrEqual(44);
    expect(card.height, 'card is a thumb target tall').toBeGreaterThanOrEqual(44);
    expect(card.x, 'card starts inside the viewport').toBeGreaterThanOrEqual(0);
    expect(card.y).toBeGreaterThanOrEqual(0);
    expect(card.x + card.width, 'card never runs past the right edge').toBeLessThanOrEqual(
      p.viewport.width + 0.5,
    );
    expect(card.y + card.height, 'card never runs past the bottom edge').toBeLessThanOrEqual(
      p.viewport.height + 0.5,
    );
  }

  // Evidence for the PR body — the arena row as a first-time player meets it, in
  // the lobby beside the hull tiles and the roster.
  await page.screenshot({ path: 'tests/live-stage/map-picker-evidence.png' });

  expect(pageErrors, 'no page errors on the lobby').toEqual([]);
});

test('picking each arena then RUSH boots that arena — the world planets ARE the registry layout', async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));

  await openLobby(page);
  const order = await page.evaluate(() => window.__lobby!.mapOrder);
  expect(order.length).toBe(4);

  for (const mapId of order) {
    // A fresh boot per map — a match boots exactly once, so each arena needs its
    // own page load (the same discipline the offline boot itself keeps).
    await openLobby(page);

    // Pick this map's card and confirm it is now selected.
    const index = order.indexOf(mapId);
    await page.evaluate((i) => window.__lobby!.selectMap(i), index);
    const selected = await page.evaluate(() => window.__lobby!.selectedMapId);
    expect(selected, `picking card ${index} selects ${mapId}`).toBe(mapId);

    // RUSH! → the countdown boots the world.
    await page.evaluate(() => window.__lobby!.rush());

    // Wait for the built world's planets to be reported onto the lobby seam.
    await page.waitForFunction(() => window.__lobby?.worldPlanets != null, undefined, {
      timeout: 20_000,
    });

    const built = await page.evaluate(() => ({
      worldMapId: window.__lobby!.worldMapId,
      worldPlanets: window.__lobby!.worldPlanets,
      expected: window.__lobby!.expectedPlanets,
    }));

    // The arena the sim built IS the one that was picked…
    expect(built.worldMapId, `the sim built ${mapId}`).toBe(mapId);
    const planets = built.worldPlanets!;
    const registry = built.expected[mapId]!;
    expect(planets, 'one home planet per slot (GDD §2.1)').toHaveLength(registry.length);
    // …and every home planet sits exactly where the registry places it (m8-02/p2:
    // "planet positions match that registry entry exactly").
    for (let i = 0; i < registry.length; i++) {
      expect(planets[i]!.x, `${mapId} planet ${i} x`).toBeCloseTo(registry[i]!.x, 3);
      expect(planets[i]!.y, `${mapId} planet ${i} y`).toBeCloseTo(registry[i]!.y, 3);
    }

    // The anti-fallback guard: a non-default map must NOT have quietly booted the
    // default arena (the exact bug a missing mapId wire would cause).
    if (mapId !== 'octagon') {
      const octagon = built.expected['octagon']!;
      const same = planets.every(
        (p, i) => Math.abs(p.x - octagon[i]!.x) < 1 && Math.abs(p.y - octagon[i]!.y) < 1,
      );
      expect(same, `${mapId} did not silently boot the default octagon board`).toBe(false);
    }
  }

  expect(pageErrors, 'no page errors across four arena boots').toEqual([]);
});

test('the last arena picked survives a reload (localStorage, same seam as the fire mode)', async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));

  await openLobby(page);
  // Pick a NON-default arena so a reload landing on the default would be caught.
  const order = await page.evaluate(() => window.__lobby!.mapOrder);
  const target = order.find((id) => id !== 'octagon')!;
  await page.evaluate(
    (id) => window.__lobby!.selectMap(window.__lobby!.mapOrder.indexOf(id)),
    target,
  );
  expect(await page.evaluate(() => window.__lobby!.selectedMapId)).toBe(target);

  // Reload — the pick is read back from storage and the same card is preselected.
  await openLobby(page);
  expect(
    await page.evaluate(() => window.__lobby!.selectedMapId),
    'the last arena picked is still selected after a reload',
  ).toBe(target);

  expect(pageErrors, 'no page errors across the reload').toEqual([]);
});
