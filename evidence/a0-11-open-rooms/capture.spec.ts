/**
 * evidence/a0-11-open-rooms/capture.spec.ts — the two captures a0-11 asks for.
 * OWNER: Netcode Engineer.
 *
 *   1. `a0-11-fresh-room.png` — a newly created ONLINE room: eight physical
 *      slots, the host in one, **seven OPEN and no bots**, and no character named
 *      anywhere on the roster. The developer's report, on a real screen.
 *   2. `a0-11-local-revert.png` — the same host seats two bots and presses RUSH!.
 *      The match boots, and the ROOM IS GONE: the allocator answers 404 for its
 *      code, so nothing is being held on the Machine. The one-line tell is on
 *      screen beside it.
 *
 * Both are taken against the shipped allocator + the shipped match server (see
 * `./playwright.config.ts`), and every claim that matters is asked of something
 * other than the client that would like it to be true: the seat states come off
 * the lobby's own drawn-control seam, and "no server session held" is asked of the
 * ALLOCATOR, after the fact.
 *
 * The readings are written to `readback.json` beside the images, so the numbers
 * survive without the pictures and a future run can be diffed against them.
 */
import { test, expect, type Page } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ALLOCATOR_URL } from '../../tests/live-stage-online/online-fleet';

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
  __mainMenu?: { visible: boolean; matchStarted: boolean; controls: readonly ControlReport[] };
  __onlineMenu?: { visible: boolean; resolvedCode: string | null; doorControls: readonly ControlReport[] };
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
    rushControl: { physicalCenter: PhysicalPoint };
  };
}
declare const window: Window & StageWindow;

const HERE = import.meta.dirname;
const readback: Record<string, unknown> = {};

/** Ask the ALLOCATOR whether a room is still live — 200 while a Machine hosts the
 *  code, 404 once nothing does. The honest question, put to the control plane. */
async function roomIsLive(code: string): Promise<boolean> {
  const res = await fetch(`${ALLOCATOR_URL}/rooms/${code}/join`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  return res.ok;
}

async function press(page: Page, p: PhysicalPoint): Promise<void> {
  const box = await page.locator('canvas').boundingBox();
  if (!box) throw new Error('no canvas');
  await page.mouse.click(box.x + p.x, box.y + p.y);
}

async function pointOf(page: Page, seam: 'menu' | 'door', kind: string): Promise<PhysicalPoint> {
  const point = await page.evaluate(
    ([which, k]) => {
      const list =
        which === 'menu' ? (window.__mainMenu?.controls ?? []) : (window.__onlineMenu?.doorControls ?? []);
      const c = list.find((x) => x.kind === k);
      return c ? { x: c.physicalCenter.x, y: c.physicalCenter.y } : null;
    },
    [seam, kind] as const,
  );
  if (!point) throw new Error(`no '${kind}' control drawn on the ${seam} screen`);
  return point;
}

test('a fresh room starts empty, and a host-plus-bots RUSH! gives the room back', async ({
  page,
  baseURL,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.goto(baseURL ?? '/', { waitUntil: 'load' });
  await page.waitForSelector('canvas', { state: 'attached', timeout: 30_000 });
  await page.waitForFunction(() => window.__mainMenu?.visible === true, undefined, { timeout: 30_000 });

  // The build actually being served, so a capture can never be attributed to a
  // bundle it did not come from (the live-stage port trap, learned the hard way).
  const version = await page.evaluate(async () => {
    try {
      const res = await fetch('/version.json');
      return res.ok ? await res.json() : null;
    } catch {
      return null;
    }
  });
  readback['servedVersion'] = version;

  // PLAY → the doors → CREATE A CLAIM.
  await press(page, await pointOf(page, 'menu', 'play'));
  await page.waitForFunction(() => window.__onlineMenu?.visible === true, undefined, { timeout: 30_000 });
  await press(page, await pointOf(page, 'door', 'create'));
  await page.waitForFunction(() => window.__lobby?.visible === true, undefined, { timeout: 60_000 });

  // ── CAPTURE 1: a newly created room ──────────────────────────────────────
  const fresh = await page.evaluate(() => {
    const l = window.__lobby;
    return l
      ? {
          room: l.room,
          online: l.online,
          you: l.you,
          isHost: l.isHost,
          slotCount: l.slotCount,
          humanCount: l.humanCount,
          size: l.size,
          seatLabels: l.seatStates.map((s) => s.label),
        }
      : null;
  });
  if (!fresh) throw new Error('the lobby seam reported nothing');
  readback['freshRoom'] = fresh;

  await page.screenshot({ path: resolve(HERE, 'a0-11-fresh-room.png') });

  // The developer's sentence, as assertions on what the screen is drawing.
  expect(fresh.online, 'this is a real online room').toBe(true);
  expect(fresh.slotCount, 'eight physical slots (GDD §2.1)').toBe(8);
  expect(fresh.seatLabels.filter((w) => w === 'BOT'), 'no bots in a fresh room').toHaveLength(0);
  expect(fresh.seatLabels.filter((w) => w === 'OPEN'), 'seven open chairs').toHaveLength(7);
  expect(fresh.seatLabels.filter((w) => w === 'TAKEN'), 'and the host in theirs').toHaveLength(1);
  // N counts humans plus bots (GDD §2.1 amended 2026-08-07) — so, just you.
  expect(fresh.size, 'nobody else is in the match yet').toBe(1);

  const code = fresh.room;
  expect(await roomIsLive(code), 'the room is real and the allocator knows it').toBe(true);

  // ── CAPTURE 2: the host seats two bots and RUSHes ────────────────────────
  // Two taps on two rows' STATE controls: OPEN → BOT. "It should be up to player
  // to fill it up with bots if they want."
  for (const row of [1, 4]) {
    const p = await page.evaluate((i) => {
      const s = (window.__lobby?.seatStates ?? []).find((x) => x.index === i);
      return s ? { x: s.physicalCenter.x, y: s.physicalCenter.y } : null;
    }, row);
    if (!p) throw new Error(`no state control drawn for row ${row}`);
    await press(page, p);
    await page.waitForFunction(
      (i) => (window.__lobby?.seatStates ?? []).find((x) => x.index === i)?.label === 'BOT',
      row,
      { timeout: 10_000 },
    );
  }

  const configured = await page.evaluate(() => {
    const l = window.__lobby;
    return l ? { size: l.size, humanCount: l.humanCount, seatLabels: l.seatStates.map((s) => s.label) } : null;
  });
  readback['beforeRush'] = configured;
  expect(configured?.size, 'one human and two bots is a three-player match').toBe(3);

  // RUSH!, and let the countdown run out.
  await press(page, (await page.evaluate(() => {
    const c = window.__lobby?.rushControl.physicalCenter;
    return c ? { x: c.x, y: c.y } : null;
  })) as PhysicalPoint);
  await page.waitForFunction(() => window.__mainMenu?.matchStarted === true, undefined, {
    timeout: 60_000,
  });

  // The tell — one line, no buttons, over a match that is already running.
  const tell = await page.evaluate(() => {
    const el = document.getElementById('pr-local-revert');
    return el ? { text: el.textContent, buttons: el.querySelectorAll('button').length } : null;
  });
  readback['tell'] = tell;
  expect(tell?.text, 'the player is told, once, in a line').toBe('NOBODY JOINED — PLAYING LOCALLY');
  expect(tell?.buttons, 'a tell, not a dialog').toBe(0);

  await page.screenshot({ path: resolve(HERE, 'a0-11-local-revert.png') });

  // ── THE CLAIM THIS WHOLE CAPTURE EXISTS FOR ──────────────────────────────
  // Not "the client stopped talking to the room" — the ROOM IS GONE. Asked of the
  // allocator, which is the thing that would still be paying for it.
  await expect
    .poll(() => roomIsLive(code), { timeout: 30_000, message: `room ${code} is still held` })
    .toBe(false);
  readback['releasedRoom'] = code;
  readback['roomStillHeldAfterRush'] = false;
  readback['pageErrors'] = errors;

  expect(errors, 'the client threw nothing on the way').toEqual([]);
  writeFileSync(resolve(HERE, 'readback.json'), `${JSON.stringify(readback, null, 2)}\n`);
});
