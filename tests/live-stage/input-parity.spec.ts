/**
 * tests/live-stage/input-parity.spec.ts — the parity table, fired for real.
 * OWNER: Platform Engineer.
 *
 * The unit suite proves every abstract Action is *reachable* from touch
 * (src/platform/input-parity.test.ts, headless). This proves the same controls
 * survive the whole real pipeline — the shipped `vite preview` bundle, a genuine
 * CDP touch, the DOM edge, the twin sticks + FIRE button, the funnel — and that
 * the sim actually receives each action. It reads `window.__planetRush.input`
 * (the `?debug=1` seam, src/platform/debug-hook.ts `installInputProbe`): the
 * abstract input the sim was handed this frame.
 *
 * Touch context: the live-stage config's `desktop` project has `hasTouch:false`,
 * so `main.ts`'s `isTouch` would be false and the touch affordances would not
 * exist. We override to a landscape touch viewport for THIS spec only, so the game
 * boots touch-first in landscape (no rotation → logical == CSS px, so the layout
 * registry's button rects map straight to CDP coordinates).
 *
 * Button geometry is read from `window.__planetRush.layout` (the registry the same
 * `main.ts` frame fills), not hardcoded — so a tuning change to a button's size or
 * anchor can never silently drift this test off the control it means to press.
 */
import { test, expect, type Page, type CDPSession } from '@playwright/test';

// A landscape touch phone: isTouch true (affordances render), w > h (landscape
// lock is a no-op, so logical space == CSS px and the button rects map 1:1).
test.use({ hasTouch: true, isMobile: true, viewport: { width: 900, height: 420 } });

/** The `?debug=1` input probe shape this spec reads (subset). */
interface InputReadout {
  frame: number;
  types: string[];
  fire: boolean;
  aim: boolean;
  thrust: { x: number; y: number };
}

async function boot(page: Page): Promise<void> {
  await page.goto('/?debug=1');
  await page.waitForSelector('canvas', { state: 'attached', timeout: 30_000 });
  // Wait until both seams are live: the input probe and a populated layout.
  await page.waitForFunction(
    () => {
      const d = (window as unknown as { __planetRush?: { input?: unknown; layout?: unknown[] } }).__planetRush;
      return !!d && !!d.input && Array.isArray(d.layout) && d.layout.length > 0;
    },
    undefined,
    { timeout: 20_000 },
  );
  await page.waitForTimeout(400); // a few frames so every affordance is registered
}

/** The centre (CSS px) of a registered layout element, or null if not on screen. */
async function centerOf(page: Page, id: string): Promise<{ x: number; y: number } | null> {
  return page.evaluate((wantId) => {
    const d = (window as unknown as { __planetRush: { layout: { id: string; bounds: DOMRect }[] } }).__planetRush;
    const e = d.layout.find((x) => x.id === wantId);
    return e ? { x: e.bounds.x + e.bounds.width / 2, y: e.bounds.y + e.bounds.height / 2 } : null;
  }, id);
}

async function readInput(page: Page): Promise<InputReadout> {
  return page.evaluate(
    () => (window as unknown as { __planetRush: { input: InputReadout } }).__planetRush.input,
  ) as Promise<InputReadout>;
}

/** Hold a single touch at (x,y), let a few sim frames pass, read the probe while it
 *  is still held, then release. Returns what the sim saw mid-hold. */
async function holdAndRead(page: Page, x: number, y: number): Promise<InputReadout> {
  const client: CDPSession = await page.context().newCDPSession(page);
  try {
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    await page.waitForTimeout(250); // a handful of fixed ticks while held
    const seen = await readInput(page);
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    return seen;
  } finally {
    await client.detach();
  }
}

/** A drag held from `from` to `to` (ramped), read mid-hold, then released. */
async function dragAndRead(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
): Promise<InputReadout> {
  const client: CDPSession = await page.context().newCDPSession(page);
  try {
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: from.x, y: from.y }] });
    for (let i = 1; i <= 6; i++) {
      const x = from.x + ((to.x - from.x) * i) / 6;
      const y = from.y + ((to.y - from.y) * i) / 6;
      await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] });
    }
    await page.waitForTimeout(250);
    const seen = await readInput(page);
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    return seen;
  } finally {
    await client.detach();
  }
}

test('touch left-stick drag → the sim receives thrust', async ({ page }) => {
  await boot(page);
  const seen = await dragAndRead(page, { x: 200, y: 300 }, { x: 60, y: 300 });
  const mag = Math.hypot(seen.thrust.x, seen.thrust.y);
  expect(mag, `thrust magnitude the sim received (${seen.thrust.x}, ${seen.thrust.y})`).toBeGreaterThan(0.2);
});

test('touch FIRE button → the sim receives an active fire', async ({ page }) => {
  await boot(page);
  const fire = await centerOf(page, 'touch-fire-button');
  expect(fire, 'FIRE button registered its layout rect').not.toBeNull();
  const seen = await holdAndRead(page, fire!.x, fire!.y);
  expect(seen.fire, 'fire.active while holding the FIRE button').toBe(true);
});

