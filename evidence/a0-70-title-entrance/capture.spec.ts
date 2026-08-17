/**
 * evidence/a0-70-title-entrance/capture.spec.ts — OWNER: UI Engineer (a0-70).
 *
 * Film the first second of the first screen the player ever sees, on the real
 * production bundle, at the developer's own 1707×898 desktop session.
 *
 * Two runs, because one of them is the control:
 *
 *  - `/`        — the shipped boot: title gate in front of the main menu.
 *  - `/?gate=0` — the same menu with **no door in front of it** (`gateEnabled`).
 *    If the menu still arrives from a corner here, the gate is not what moves it
 *    and candidate 3 is dead. If it is already in place here, the gate is.
 *
 * Frames come off CDP `Page.startScreencast`, started BEFORE navigation, so the
 * very first painted frame is in the set — a `page.screenshot()` loop cannot
 * make that claim (each shot costs tens of ms and the first one lands after the
 * window under test). Every frame is stamped with the CDP metadata timestamp so
 * "which frame it is wrong on" is answerable rather than estimated.
 */
import { test, expect } from '@playwright/test';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
/** `frames/before` on today's code; re-run with A0_70_LABEL=after post-fix. */
const LABEL = process.env.A0_70_LABEL ?? 'before';

/** How long the window under test is. The report is about "the first second". */
const WINDOW_MS = 1400;

interface Frame {
  readonly index: number;
  readonly ms: number;
  readonly file: string;
}

async function film(page: import('@playwright/test').Page, url: string, dir: string): Promise<Frame[]> {
  const out = join(HERE, 'frames', LABEL, dir);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });

  const client = await page.context().newCDPSession(page);
  const frames: Frame[] = [];
  let t0: number | null = null;

  client.on('Page.screencastFrame', (evt) => {
    const stamp = evt.metadata.timestamp ?? 0;
    if (t0 === null) t0 = stamp;
    const ms = Math.round((stamp - t0) * 1000);
    const index = frames.length;
    const file = `f${String(index).padStart(3, '0')}-${String(ms).padStart(5, '0')}ms.png`;
    writeFileSync(join(out, file), Buffer.from(evt.data, 'base64'));
    frames.push({ index, ms, file });
    void client.send('Page.screencastFrameAck', { sessionId: evt.sessionId }).catch(() => {});
  });

  await client.send('Page.startScreencast', { format: 'png', everyNthFrame: 1 });
  await page.goto(url, { waitUntil: 'commit' });
  await page.waitForTimeout(WINDOW_MS);
  await client.send('Page.stopScreencast');
  await client.detach();

  writeFileSync(join(out, 'frames.json'), JSON.stringify(frames, null, 2));
  return frames;
}

test('film the first second, gate and no-gate', async ({ page }) => {
  const gated = await film(page, '/', 'gated');
  expect(gated.length).toBeGreaterThan(5);

  const bare = await film(page, '/?gate=0', 'no-gate');
  expect(bare.length).toBeGreaterThan(5);

  // eslint-disable-next-line no-console
  console.log(`gated: ${gated.length} frames, no-gate: ${bare.length} frames`);
});
