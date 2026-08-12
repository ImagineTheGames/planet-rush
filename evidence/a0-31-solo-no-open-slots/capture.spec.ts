/**
 * evidence/a0-31-solo-no-open-slots/capture.spec.ts — the frame a0-31 asks for.
 * OWNER: UI Engineer.
 *
 * The developer: *"in solo play there should be no slot open it's either closed
 * or bot. no one can join in solo…."*
 *
 *   1. `a0-31-solo-lobby.png` — the SOLO lobby as PLAY SOLO opens it: eight
 *      physical slots, you in one, **seven BOT rows and not one OPEN**.
 *   2. `a0-31-solo-lobby-closed.png` — the same lobby after the host walks two
 *      rows round the ring. Every rung of a solo seat is on screen at once — BOT
 *      and CLOSED — and OPEN is still nowhere, which is the whole brief.
 *
 * Every screen is reached by a REAL press at the physical point the client itself
 * reported drawing the control at — the front door, not a debug seam — and the
 * words are read back off `window.__lobby.seatStates`, which is the label the view
 * actually drew rather than a model a test built. The labels are sampled after
 * EVERY press, not just at the two shots, so a lobby that flashed OPEN between two
 * legal states could not pass this quietly.
 *
 * The readings are written to `readback.json` beside the images, so the numbers
 * survive without the pictures and a future run can be diffed against them.
 */
import { test, expect, type Page } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

interface PhysicalPoint {
  readonly x: number;
  readonly y: number;
}
interface ControlReport {
  readonly kind: string;
  readonly physicalCenter: PhysicalPoint;
}
interface SeatStateReport {
  readonly index: number;
  readonly label: string;
  readonly live: boolean;
  readonly physicalCenter: PhysicalPoint;
}
interface StageWindow {
  __mainMenu?: { screen: string; controls: readonly ControlReport[] };
  __onlineMenu?: { visible: boolean; doorControls: readonly ControlReport[] };
  __lobby?: {
    visible: boolean;
    online: boolean;
    room: string;
    you: number;
    isHost: boolean;
    humanCount: number;
    slotCount: number;
    size: number;
    seatStates: readonly SeatStateReport[];
  };
}
declare const window: Window & StageWindow;

const HERE = import.meta.dirname;
const readback: Record<string, unknown> = {};
/** Every label this lobby has EVER drawn on any row, across every press below.
 *  The brief's claim is about the whole session, not about two still frames. */
const everSeen = new Set<string>();

async function press(page: Page, p: PhysicalPoint): Promise<void> {
  const box = await page.locator('canvas').boundingBox();
  if (!box) throw new Error('no canvas');
  await page.mouse.click(box.x + p.x, box.y + p.y);
}

async function pointOf(page: Page, seam: 'menu' | 'door', kind: string): Promise<PhysicalPoint> {
  const point = await page.evaluate(
    ([which, k]) => {
      const list =
        which === 'menu'
          ? (window.__mainMenu?.controls ?? [])
          : (window.__onlineMenu?.doorControls ?? []);
      const c = list.find((x) => x.kind === k);
      return c ? { x: c.physicalCenter.x, y: c.physicalCenter.y } : null;
    },
    [seam, kind] as const,
  );
  if (!point) throw new Error(`no '${kind}' control drawn on the ${seam} screen`);
  return point;
}

/** The words the roster is drawing right now — and a running record of every word
 *  it has drawn, so OPEN cannot appear in a frame nobody screenshotted. */
async function seatLabels(page: Page): Promise<string[]> {
  const labels = await page.evaluate(() =>
    (window.__lobby?.seatStates ?? []).map((s) => s.label),
  );
  for (const word of labels) everSeen.add(word);
  return labels;
}

test('a solo lobby offers BOT and CLOSED, and never an OPEN seat', async ({ page, baseURL }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.goto(baseURL ?? '/', { waitUntil: 'load' });
  await page.waitForSelector('canvas', { state: 'attached', timeout: 30_000 });
  await page.waitForFunction(() => typeof window.__mainMenu?.screen === 'string', undefined, {
    timeout: 30_000,
  });

  // The build actually being served, so a capture can never be attributed to a
  // bundle it did not come from (the live-stage port trap, learned the hard way).
  readback['servedVersion'] = await page.evaluate(async () => {
    try {
      const res = await fetch('/version.json');
      return res.ok ? await res.json() : null;
    } catch {
      return null;
    }
  });

  // PLAY → the doors → PLAY SOLO. Real presses, at the points the client reported.
  await press(page, await pointOf(page, 'menu', 'play'));
  await page.waitForFunction(() => window.__onlineMenu?.visible === true, undefined, {
    timeout: 30_000,
  });
  await press(page, await pointOf(page, 'door', 'solo'));
  await page.waitForFunction(() => window.__lobby?.visible === true, undefined, { timeout: 60_000 });

  // ── CAPTURE 1: the solo lobby as it opens ────────────────────────────────
  const opened = await page.evaluate(() => {
    const l = window.__lobby;
    return l
      ? {
          online: l.online,
          you: l.you,
          isHost: l.isHost,
          slotCount: l.slotCount,
          humanCount: l.humanCount,
          size: l.size,
        }
      : null;
  });
  if (!opened) throw new Error('the lobby seam reported nothing');
  const fresh = await seatLabels(page);
  readback['freshSolo'] = { ...opened, seatLabels: fresh };

  await page.screenshot({ path: resolve(HERE, 'a0-31-solo-lobby.png') });

  expect(opened.online, 'this is the SOLO lobby — nobody can join it').toBe(false);
  expect(opened.slotCount, 'eight physical slots (GDD §2.1)').toBe(8);
  expect(fresh.filter((w) => w === 'OPEN'), 'a solo lobby drew an OPEN seat').toHaveLength(0);
  expect(fresh.filter((w) => w === 'BOT'), 'seven bots — the solo cast').toHaveLength(7);
  expect(fresh.filter((w) => w === 'TAKEN'), 'and you in yours').toHaveLength(1);

  // ── The ring, walked for real ────────────────────────────────────────────
  // Three presses on one row: a full lap of the SOLO ring is two rungs, so the
  // third press proves the lap has no third rung to land on. The labels are read
  // after every one of them.
  const ROW = 3;
  const walked: string[] = [];
  for (let i = 0; i < 3; i++) {
    const p = await page.evaluate((index) => {
      const s = (window.__lobby?.seatStates ?? []).find((x) => x.index === index);
      return s ? { x: s.physicalCenter.x, y: s.physicalCenter.y } : null;
    }, ROW);
    if (!p) throw new Error(`no state control drawn for row ${ROW}`);
    const before = (await seatLabels(page))[ROW]!;
    await press(page, p);
    await page.waitForFunction(
      ([index, was]) =>
        (window.__lobby?.seatStates ?? []).find((x) => x.index === Number(index))?.label !== was,
      [String(ROW), before] as const,
      { timeout: 10_000 },
    );
    walked.push((await seatLabels(page))[ROW]!);
  }
  readback['ringWalked'] = walked;
  expect(walked, 'the solo ring is BOT ⇄ CLOSED — two rungs, and OPEN is not one').toEqual([
    'CLOSED',
    'BOT',
    'CLOSED',
  ]);

  // ── CAPTURE 2: both rungs on screen at once ──────────────────────────────
  // Row 3 is already CLOSED; close row 6 as well, so the frame shows a roster a
  // host has actually shaped — bots, shut doors, and no chair nobody can take.
  const p6 = await page.evaluate(() => {
    const s = (window.__lobby?.seatStates ?? []).find((x) => x.index === 6);
    return s ? { x: s.physicalCenter.x, y: s.physicalCenter.y } : null;
  });
  if (!p6) throw new Error('no state control drawn for row 6');
  await press(page, p6);
  await page.waitForFunction(
    () => (window.__lobby?.seatStates ?? []).find((x) => x.index === 6)?.label === 'CLOSED',
    undefined,
    { timeout: 10_000 },
  );

  const shaped = await seatLabels(page);
  const after = await page.evaluate(() => {
    const l = window.__lobby;
    return l ? { size: l.size, humanCount: l.humanCount } : null;
  });
  readback['shapedSolo'] = { ...after, seatLabels: shaped };

  await page.screenshot({ path: resolve(HERE, 'a0-31-solo-lobby-closed.png') });

  expect(shaped[3], 'row 3 is shut').toBe('CLOSED');
  expect(shaped[6], 'row 6 is shut').toBe('CLOSED');
  expect(shaped.filter((w) => w === 'OPEN'), 'a shaped solo roster drew an OPEN seat').toHaveLength(0);
  // N counts humans plus bots (GDD §2.1, amended 2026-08-07): you plus five bots.
  expect(after?.size, 'two seats shut, six in the match').toBe(6);

  // ── THE CLAIM THIS CAPTURE EXISTS FOR ────────────────────────────────────
  // Not "no OPEN in the two frames" — no OPEN in ANY frame this session drew, on
  // any row, at any point in the walk.
  readback['everSeenLabels'] = [...everSeen].sort();
  readback['pageErrors'] = errors;
  expect([...everSeen].sort(), 'a solo lobby drew OPEN at some point in the walk').toEqual([
    'BOT',
    'CLOSED',
    'TAKEN',
  ]);
  expect(errors, 'the client threw nothing on the way').toEqual([]);

  writeFileSync(resolve(HERE, 'readback.json'), `${JSON.stringify(readback, null, 2)}\n`);
});
