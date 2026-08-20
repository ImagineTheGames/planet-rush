/**
 * evidence/a0-110-friend-or-foe-minimap/shots.spec.ts — OWNER: UI Engineer.
 *
 * The frames the ruling is about:
 *
 * > *"i feel like on minimap friendlies should all be blue, and enemies all red…
 * > it would just make it easier to understand, also decrease the size of the ship
 * > icons on the minimap"*
 *
 * Two devices, because the brief asks for both: the developer's own phone
 * (**798×384 dpr 3**, `evidence/a0-74-viewport/profiles.ts` `phone-798x384`) and
 * the **1280×800** desktop the golden suite shoots. Each is shot COLLAPSED (the
 * corner map — the object the complaint is about) and EXPANDED (the same decision,
 * large enough that a reviewer can see which mark is which).
 *
 * **The scene is a TEAMS match with sides.** `?sides=2` is the debug boot's TEAMS
 * switch (`src/main.ts` `readDebugSides`) — the 4v4 split a host gets by tapping
 * TEAMS — so the frame has a real ally table rather than FFA's teams-of-one, and
 * `__minimapStage.stageSides()` parks one ally, two rivals and their homes inside
 * the viewer's own ship sensor, plus a rival's wreck. Without it the frame is a
 * picture of one blue square: the map renders only the player's SENSED state
 * (feature f1), and two seconds into the frozen scene a viewer senses their own
 * home and nothing else (a0-88's readback: `ship 0`).
 *
 * That stage is the ONE seam here that is not on origin/main, which is why it is
 * its own commit — see README.md for how the `before` half is captured. It stages
 * sim POSITIONS and one zeroed core; the shipped pipeline still computes the fog,
 * resolves the allegiance and paints every mark, so it cannot fake what it stages
 * for. Every other seam used (`__minimapStage.state/physicalPoint`) is on main.
 *
 * Usage (from the repo root):
 *   npx playwright test --config evidence/a0-110-friend-or-foe-minimap/playwright.config.ts
 *   A0_110_LABEL=before A0_110_REUSE=1 PREVIEW_PORT=4291 npx playwright test \
 *     --config evidence/a0-110-friend-or-foe-minimap/playwright.config.ts
 */
import { test, expect, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { settleFrames } from '../../tests/mobile/render-settle';

const HERE = dirname(fileURLToPath(import.meta.url));
const SHOTS = join(HERE, 'shots');
/** `after` (this branch) or `before` (a worktree of origin/main + the stage sha). */
const LABEL = process.env.A0_110_LABEL ?? 'after';

/** The two profiles the brief asks for. */
const PROFILES = [
  { id: 'phone', viewport: { width: 798, height: 384 }, dpr: 3, touch: true },
  { id: 'desktop', viewport: { width: 1280, height: 800 }, dpr: 1, touch: false },
] as const;

/** The frozen, seeded scene WITH SIDES. `gate=0` skips the title gate. */
const SCENE = '/?debug=1&freeze=1&sides=2&gate=0';

interface Drawn {
  expanded: boolean;
  rect: { x: number; y: number; width: number; height: number };
  ownDot: { x: number; y: number } | null;
  stationCount: number;
  shipCount: number;
  oreCount: number;
  satelliteCount: number;
  coverageCount: number;
  collapseRing: boolean;
}

interface Staged {
  viewer: number;
  ally: number | null;
  hostiles: number[];
  wreck: number | null;
}

declare global {
  interface Window {
    __minimapStage?: {
      state(): Drawn;
      physicalPoint(x: number, y: number): { x: number; y: number };
      stageSides?(): Staged | null;
    };
  }
}

const readback: Record<string, unknown> = { label: LABEL, scene: SCENE };

async function boot(page: Page): Promise<void> {
  await page.goto(SCENE);
  await page.waitForSelector('canvas', { state: 'attached', timeout: 60_000 });
  await page.waitForFunction(() => window.__minimapStage !== undefined, null, { timeout: 30_000 });
  await page.evaluate(() => document.fonts?.ready);
  await settleFrames(page, 16);
}

/**
 * Force the minimap's cached content to rebuild, by toggling the overlay with the
 * REAL tap/click.
 *
 * Not belt-and-braces — a0-42 and a0-88 both wrote this trap down. The content is
 * a cached Graphics rebuilt every `MINIMAP_REDRAW_TICKS` **sim ticks, or on a
 * rect/state change**; under `?freeze=1` the tick never advances, so a scene
 * re-staged after boot would keep showing the FIRST rebuild while the sim moved
 * underneath it. A toggle is the state change that forces an honest rebuild, and
 * it goes through the same gesture a player uses.
 */
async function refresh(page: Page, wantExpanded: boolean): Promise<Drawn> {
  for (let i = 0; i < 4; i++) {
    const s = await page.evaluate(() => window.__minimapStage!.state());
    if (s.expanded === wantExpanded && i > 0) break;
    const p = await page.evaluate(
      (r) => window.__minimapStage!.physicalPoint(r.x + r.width / 2, r.y + r.height / 2),
      s.rect,
    );
    await page.mouse.click(p.x, p.y);
    await settleFrames(page, 8);
  }
  const out = await page.evaluate(() => window.__minimapStage!.state());
  expect(out.expanded).toBe(wantExpanded);
  return out;
}

/** Full frame + a clip of the minimap alone, at the device's own scale. */
async function shoot(
  page: Page,
  name: string,
  drawn: Drawn,
  profile: (typeof PROFILES)[number],
): Promise<void> {
  writeFileSync(join(SHOTS, `${LABEL}-${name}-full.png`), await page.screenshot());
  const tl = await page.evaluate((r) => window.__minimapStage!.physicalPoint(r.x, r.y), drawn.rect);
  const br = await page.evaluate(
    (r) => window.__minimapStage!.physicalPoint(r.x + r.width, r.y + r.height),
    drawn.rect,
  );
  const pad = 4; // a few px of air so the frame border and chamfer are in
  const x = Math.max(0, Math.min(tl.x, br.x) - pad);
  const y = Math.max(0, Math.min(tl.y, br.y) - pad);
  const width = Math.min(profile.viewport.width - x, Math.abs(br.x - tl.x) + pad * 2);
  const height = Math.min(profile.viewport.height - y, Math.abs(br.y - tl.y) + pad * 2);
  writeFileSync(
    join(SHOTS, `${LABEL}-${name}-map.png`),
    await page.screenshot({ clip: { x, y, width, height } }),
  );
  readback[name] = { drawn, clip: { x, y, width, height } };
}

test.beforeAll(() => mkdirSync(SHOTS, { recursive: true }));
test.afterAll(() => {
  writeFileSync(join(SHOTS, `${LABEL}-readback.json`), JSON.stringify(readback, null, 2));
});

for (const profile of PROFILES) {
  test.describe(`a0-110 — ${profile.id} ${profile.viewport.width}×${profile.viewport.height} dpr ${profile.dpr} (${LABEL})`, () => {
    test.use({
      viewport: profile.viewport,
      deviceScaleFactor: profile.dpr,
      isMobile: profile.touch,
      hasTouch: profile.touch,
    });

    for (const expanded of [false, true]) {
      const state = expanded ? 'expanded' : 'collapsed';

      test(`${state} — one ally, two rivals, and a wreck on one map`, async ({ page }) => {
        await boot(page);

        // Stage the sides. Fail loudly rather than shoot a frame that is not of
        // the thing: a picture with no rival in it is not evidence about rivals.
        const staged = await page.evaluate(
          () => window.__minimapStage!.stageSides?.() ?? null,
        );
        expect(
          staged,
          'stageSides() is present — on the BEFORE half, cherry-pick the stage sha (README)',
        ).not.toBeNull();
        expect(staged!.ally, 'an ALLY is seated (?sides=2 built a real team table)').not.toBeNull();
        expect(staged!.hostiles.length, 'TWO rivals are seated').toBeGreaterThanOrEqual(2);

        const drawn = await refresh(page, expanded);

        // …and that the shipped FOG actually revealed them, which the stage does
        // not get to decide. 3 ships besides me, and homes for all of them.
        expect(drawn.ownDot, 'my own ship is on the map').not.toBeNull();
        expect(drawn.shipCount, 'the ally and both rivals are sensed').toBeGreaterThanOrEqual(3);
        expect(drawn.stationCount, 'their homes too, and a wreck').toBeGreaterThanOrEqual(3);

        readback[`${profile.id}-${state}-staged`] = staged;
        await shoot(page, `${profile.id}-${state}`, drawn, profile);
      });
    }
  });
}
