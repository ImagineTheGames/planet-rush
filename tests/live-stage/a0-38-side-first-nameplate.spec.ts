/**
 * tests/live-stage/a0-38-side-first-nameplate.spec.ts — the side reads FIRST on a
 * nameplate, proven on the REAL booted bundle. OWNER: UI Engineer (a0-38).
 *
 * The developer, on a live build: *"friendly or enemy should be the first thing
 * displayed on a name so thats its easier to identify."*
 *
 * ## What only a boot can prove
 *
 * `src/ui/nameplates.test.ts` proves the row's arithmetic — side, then name, then
 * the difficulty tag — off `nameplateRowLayout`, the pure half of the draw loop.
 * What it cannot prove is that the LAYER lays its three pooled Texts out that way
 * in a real client, because order is a fact about x and both of the fields a
 * readback used to carry (`text`, `teamLabel`) read back identically whichever
 * side of the name the tag is drawn on. So this reads the drawn geometry back out
 * of the running client (`window.__nameplateStage.plates()`, which since a0-38
 * carries each token's left edge) and asserts the tag really is to the LEFT.
 *
 * It runs the two frames the brief names: the **390px landscape phone**, where the
 * plates sit over moving ships and the width risk lives, and a **free-for-all**
 * boot, which has no side at all and must still open with the name — no gap, no
 * stray separator, nothing moved.
 *
 * `?freeze=1` pins the sim to a fixed seeded frame so the staged entities hold
 * still, the same discipline as `nameplates.spec.ts` next to it.
 */
import { test, expect, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

/** One drawn plate as `NameplateView.debugPlates()` reports it — the text fields
 *  it always carried, plus the row geometry a0-38 added. */
interface DrawnPlate {
  owner: number;
  kind: 'ship' | 'station';
  text: string;
  suffix: string;
  teamLabel: string;
  color: number;
  teamColor: number;
  alpha: number;
  x: number;
  y: number;
  local: boolean;
  /** Left edge of the leading side tag (where one WOULD go, on an FFA plate). */
  sideX: number;
  nameX: number;
  suffixX: number;
  /** The row's true outer edges — what the layer culls and registers on. */
  left: number;
  right: number;
}
interface NameplateStage {
  stageBot(): { owner: number; name: string; difficulty: string | undefined } | null;
  plates(): DrawnPlate[];
  names(): Array<string | undefined>;
  difficulties(): Array<string | undefined>;
}
declare const window: Window & { __nameplateStage?: NameplateStage };

/** The landscape phone the brief measures at: 844×390. */
const PHONE_LANDSCAPE = { width: 844, height: 390 } as const;
/** Where the captures and the readback land. */
const OUT = 'evidence/a0-38-side-first-nameplate';

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

/** Boot the frozen client at the phone's landscape size, optionally in TEAMS,
 *  stage the rival beside the local player, and read the drawn plates back. */
async function bootPlates(page: Page, url: string): Promise<DrawnPlate[]> {
  await page.setViewportSize({ width: PHONE_LANDSCAPE.width, height: PHONE_LANDSCAPE.height });
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForSelector('canvas', { state: 'attached', timeout: 30_000 });
  await page.waitForFunction(
    () => typeof window.__nameplateStage?.stageBot === 'function',
    undefined,
    { timeout: 20_000 },
  );
  const staged = await page.evaluate(() => window.__nameplateStage!.stageBot());
  expect(staged, 'a rival was available to seat beside the local player').not.toBeNull();
  await frames(page);
  return page.evaluate(() => window.__nameplateStage!.plates());
}

/** The row as a player reads it, left→right — rebuilt from the DRAWN x of each
 *  token, so it is the screen's own order and not the model's field order. */
function readRow(p: DrawnPlate): string {
  const tokens: Array<{ x: number; text: string }> = [{ x: p.nameX, text: p.text }];
  if (p.teamLabel.length > 0) tokens.push({ x: p.sideX, text: p.teamLabel });
  if (p.suffix.length > 0) tokens.push({ x: p.suffixX, text: p.suffix });
  return tokens
    .sort((a, b) => a.x - b.x)
    .map((t) => t.text)
    .join(' ');
}

test.describe('the side leads a drawn nameplate (a0-38)', () => {
  test('TEAMS, 390px landscape — every drawn plate opens with FRIENDLY / ENEMY', async ({
    page,
  }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (e) => pageErrors.push(String(e)));

    const plates = await bootPlates(page, '/?debug=1&freeze=1&sides=2');
    const sided = plates.filter((p) => p.teamLabel.length > 0);
    expect(sided.length, 'a teams boot draws plates carrying a side').toBeGreaterThan(0);

    for (const p of sided) {
      // The ruling, as geometry: the tag is drawn to the LEFT of the name.
      expect(p.sideX, `${readRow(p)} — the side tag leads the name`).toBeLessThan(p.nameX);
      // Nothing is drawn before it: the tag IS the start of the row.
      expect(p.left, `${readRow(p)} — the row starts at the side tag`).toBeCloseTo(p.sideX, 3);
      // The difficulty tag is still last — recessive metadata keeps its place.
      if (p.suffix.length > 0) {
        expect(p.nameX, `${readRow(p)} — the tier tag still trails`).toBeLessThan(p.suffixX);
        expect(p.right).toBeCloseTo(p.suffixX + (p.right - p.suffixX), 3);
      }
      // The wording is untouched (m10, u3) — this brief moved the tag, not its text.
      expect(p.teamLabel).toMatch(/^(FRIENDLY|ENEMY|TEAM) [A-D]$/);
      // Always lit (a0-04), whatever the row order is.
      expect(p.alpha).toBeGreaterThan(0.9);
      // The whole row is on the canvas — the cull's promise, measured on the row
      // and not on the name, now that the row reaches both ways from its ship.
      expect(p.left).toBeGreaterThanOrEqual(0);
      expect(p.right).toBeLessThanOrEqual(PHONE_LANDSCAPE.width);
    }

    // The developer's own two reads, from the drawn frame.
    const rows = plates.map(readRow);
    expect(rows.some((r) => r.startsWith('ENEMY B ')), rows.join(' | ')).toBe(true);
    expect(rows.some((r) => r.startsWith('FRIENDLY A ')), rows.join(' | ')).toBe(true);

    // The LOCAL player's plate — a0-38 asks what it becomes, and the answer is the
    // same rule as every other plate: `FRIENDLY A YOU`.
    const mine = plates.find((p) => p.owner === 0);
    expect(mine, 'the local player carries a plate').toBeDefined();
    expect(readRow(mine!)).toBe('FRIENDLY A YOU');
    expect(mine!.suffix, 'a human seat never carries a tier').toBe('');

    mkdirSync(OUT, { recursive: true });
    await page.screenshot({ path: `${OUT}/teams-390-landscape.png` });
    writeFileSync(
      `${OUT}/teams-390-landscape.json`,
      `${JSON.stringify({ viewport: PHONE_LANDSCAPE, rows, plates }, null, 2)}\n`,
    );
    expect(pageErrors, pageErrors.join('\n')).toEqual([]);
  });

  test('FFA, 390px landscape — the row opens with the NAME, with no gap where a tag is not', async ({
    page,
  }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (e) => pageErrors.push(String(e)));

    const plates = await bootPlates(page, '/?debug=1&freeze=1');
    expect(plates.length, 'a free-for-all boot still draws plates').toBeGreaterThan(0);

    for (const p of plates) {
      expect(p.teamLabel, 'teams-of-one has no side worth naming').toBe('');
      // The row starts at the name itself — not one gap to the right of nothing.
      expect(p.left, `${readRow(p)} — no leading gap`).toBeCloseTo(p.nameX, 3);
      // And the name is still centred on its entity, exactly where it always was:
      // `x` is the entity the plate tracks, and the name straddles it.
      expect(p.nameX).toBeLessThan(p.x);
      expect(p.right).toBeGreaterThan(p.x);
    }

    mkdirSync(OUT, { recursive: true });
    await page.screenshot({ path: `${OUT}/ffa-390-landscape.png` });
    writeFileSync(
      `${OUT}/ffa-390-landscape.json`,
      `${JSON.stringify({ viewport: PHONE_LANDSCAPE, rows: plates.map(readRow), plates }, null, 2)}\n`,
    );
    expect(pageErrors, pageErrors.join('\n')).toEqual([]);
  });

  test('a crowded frame — the drawn rows do not run into each other', async ({ page }) => {
    // Where leading with a longer tag was expected to bite: two plates near each
    // other. The staged TEAMS frame puts three on screen — the rival's ship, the
    // rival's home and the local player's home — inside a 390px-tall viewport, so
    // this measures what the crowding actually costs rather than eyeballing it.
    const pageErrors: string[] = [];
    page.on('pageerror', (e) => pageErrors.push(String(e)));

    const plates = await bootPlates(page, '/?debug=1&freeze=1&sides=2');
    expect(plates.length, 'more than one plate on screen').toBeGreaterThan(1);

    const pairs: Array<Record<string, unknown>> = [];
    for (let i = 0; i < plates.length; i++) {
      for (let j = i + 1; j < plates.length; j++) {
        const a = plates[i]!;
        const b = plates[j]!;
        // Overlap of the two rows on each axis; negative is clear air between them.
        const xOverlap = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const yGap = Math.abs(a.y - b.y);
        pairs.push({ a: readRow(a), b: readRow(b), xOverlap, yGap });
        // Two rows may share a column OR a line, never both — a plate that lands on
        // another plate is the failure this frame exists to catch.
        expect(
          xOverlap < 0 || yGap > 0,
          `"${readRow(a)}" and "${readRow(b)}" occupy the same pixels`,
        ).toBe(true);
      }
    }

    mkdirSync(OUT, { recursive: true });
    writeFileSync(`${OUT}/crowded-390-landscape.json`, `${JSON.stringify({ pairs }, null, 2)}\n`);
    expect(pageErrors, pageErrors.join('\n')).toEqual([]);
  });
});
